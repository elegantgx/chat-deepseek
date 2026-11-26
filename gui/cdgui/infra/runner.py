"""命令调度：单工作线程串行执行 + 主线程回投 + 代际丢弃。

这是新架构里唯一允许起线程的地方（`serve.py` / `ssh.py` 的进程泵除外）。
设计对应 `REFACTOR_PLAN.md` §5.3：

- 一条串行 lane：所有 `TaskKey` 共用一个工作线程，天然避免 `backup` 与
  `backup list` 同时开 SQLite。
- 每个 `TaskKey` 一个 generation；`invalidate()` 递增代际并取消 token，
  排队中/执行中的旧任务结果按代际静默丢弃。
- 回调经 `QueuePump` 回投，Qt 侧用 30ms 定时器 `drain()`；测试直接 drain。
- `blocking=True`（用户动作）在有任务进行中时直接拒绝，返回 None；内部后续
  任务用 `blocking=False` 排队。
- 本模块不导入 Qt。
"""

from __future__ import annotations

import queue
import threading
from collections import deque
from dataclasses import dataclass
from types import MappingProxyType
from typing import Callable, Mapping

from ..domain.state import InflightEntry, TaskKey

# fn 接收本任务的 CancelToken；gateway 方法把 token 透传给 transport。
CommandFn = Callable[["CancelToken"], object]
SuccessCallback = Callable[[object], None]
FailureCallback = Callable[[BaseException], None]


class CancelToken:
    """协作式取消标志；transport/run_popen 只读 `.cancelled`。"""

    def __init__(self) -> None:
        self._event = threading.Event()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def cancel(self) -> None:
        self._event.set()


class QueuePump:
    """线程安全的回调队列；`drain()` 在调用者线程（主线程）执行回调。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: deque[Callable[[], None]] = deque()
        self._closed = False

    @property
    def closed(self) -> bool:
        with self._lock:
            return self._closed

    @property
    def pending(self) -> int:
        with self._lock:
            return len(self._items)

    def post(self, callback: Callable[[], None]) -> bool:
        """入队；窗口关闭后返回 False（回调被丢弃）。"""
        with self._lock:
            if self._closed:
                return False
            self._items.append(callback)
            return True

    def drain(self) -> int:
        """执行当前排队的回调；回调里新 post 的留到下一轮。"""
        with self._lock:
            items = list(self._items)
            self._items.clear()
        for callback in items:
            try:
                callback()
            except Exception:  # noqa: BLE001 - 单个回调失败不能阻断其余回调
                pass
        return len(items)

    def close(self) -> None:
        """丢弃未执行回调并拒绝后续 post。"""
        with self._lock:
            self._closed = True
            self._items.clear()


@dataclass(frozen=True)
class _Job:
    key: TaskKey
    generation: int
    token: CancelToken
    fn: CommandFn
    on_success: SuccessCallback | None
    on_failure: FailureCallback | None


_STOP = object()


class CommandRunner:
    """一条串行 lane；目标切换时调用 `set_target` 或重建 runner。"""

    def __init__(self, target_key: str, pump: QueuePump | None = None) -> None:
        self._target_key = target_key
        self._pump = pump if pump is not None else QueuePump()
        self._lock = threading.RLock()
        self._jobs: queue.Queue[_Job | object] = queue.Queue()
        self._inflight: dict[TaskKey, InflightEntry] = {}
        self._tokens: dict[TaskKey, CancelToken] = {}
        self._generation: dict[TaskKey, int] = {}
        self._closed = False
        self._worker = threading.Thread(
            target=self._work, name="cdgui-command-runner", daemon=True
        )
        self._worker.start()

    # ---- 只读视图 -----------------------------------------------------

    @property
    def target_key(self) -> str:
        with self._lock:
            return self._target_key

    @property
    def pump(self) -> QueuePump:
        return self._pump

    @property
    def closed(self) -> bool:
        with self._lock:
            return self._closed

    @property
    def inflight(self) -> Mapping[TaskKey, InflightEntry]:
        """只读快照；渲染层据此推导 busy，不参与调度。"""
        with self._lock:
            return MappingProxyType(dict(self._inflight))

    # ---- 提交 / 作废 --------------------------------------------------

    def submit(
        self,
        key: TaskKey | str,
        fn: CommandFn,
        on_success: SuccessCallback | None = None,
        on_failure: FailureCallback | None = None,
        *,
        blocking: bool = True,
    ) -> CancelToken | None:
        """提交一个任务。

        `blocking=True` 是用户动作：已有任务在跑/排队时返回 None（界面 toast
        “正在执行上一条命令”），不排队；`blocking=False` 是内部后续任务，
        排在该任务之后执行。`fn` 必须接收一个 `CancelToken`。
        """
        task_key = TaskKey(key)
        token = CancelToken()
        with self._lock:
            if self._closed:
                return None
            if blocking and self._inflight:
                return None
            generation = self._generation.get(task_key, 0) + 1
            self._generation[task_key] = generation
            self._inflight[task_key] = InflightEntry(
                task_key=task_key,
                target_key=self._target_key,
                generation=generation,
            )
            self._tokens[task_key] = token
            self._jobs.put(
                _Job(
                    key=task_key,
                    generation=generation,
                    token=token,
                    fn=fn,
                    on_success=on_success,
                    on_failure=on_failure,
                )
            )
        return token

    def invalidate(self, *keys: TaskKey | str) -> None:
        """作废指定 key 的当前代际：取消 token，迟到结果静默丢弃。"""
        task_keys = [TaskKey(key) for key in keys]
        tokens: list[CancelToken] = []
        with self._lock:
            for task_key in task_keys:
                self._generation[task_key] = self._generation.get(task_key, 0) + 1
                self._inflight.pop(task_key, None)
                token = self._tokens.pop(task_key, None)
                if token is not None:
                    tokens.append(token)
        for token in tokens:
            token.cancel()

    def set_target(self, target_key: str) -> None:
        """切换目标：作废全部任务并改写 target_key（继续用同一个 pump）。"""
        for task_key in TaskKey:
            self.invalidate(task_key)
        with self._lock:
            self._target_key = target_key

    def close(self) -> None:
        """停止接收任务、取消在跑任务、停线程并丢弃未执行回调。"""
        tokens: list[CancelToken] = []
        with self._lock:
            if self._closed:
                return
            self._closed = True
            for task_key in list(self._generation):
                self._generation[task_key] += 1
            tokens = list(self._tokens.values())
            self._tokens.clear()
            self._inflight.clear()
        for token in tokens:
            token.cancel()
        self._jobs.put(_STOP)
        self._worker.join(timeout=5.0)
        self._pump.close()

    # ---- 工作线程 -----------------------------------------------------

    def _work(self) -> None:
        while True:
            job = self._jobs.get()
            if job is _STOP:
                return
            assert isinstance(job, _Job)
            if not self._claim(job):
                continue
            try:
                value = job.fn(job.token)
            except Exception as exc:  # noqa: BLE001 - 失败交给 on_failure
                self._finish(job, failed=True, error=exc)
            else:
                self._finish(job, value=value)

    def _claim(self, job: _Job) -> bool:
        """执行前检查代际/取消；排队期间被作废的任务不再执行。"""
        with self._lock:
            if self._closed:
                return False
            current = self._generation.get(job.key) == job.generation
            entry = self._inflight.get(job.key)
            current = current and entry is not None and entry.generation == job.generation
            if current and not job.token.cancelled:
                return True
            if entry is not None and entry.generation == job.generation:
                self._inflight.pop(job.key, None)
                self._tokens.pop(job.key, None)
            return False

    def _finish(
        self,
        job: _Job,
        *,
        value: object = None,
        error: BaseException | None = None,
        failed: bool = False,
    ) -> None:
        callback: Callable[[object], None] | None
        payload: object
        with self._lock:
            if self._closed:
                return
            if self._generation.get(job.key) != job.generation:
                return
            entry = self._inflight.get(job.key)
            if entry is not None and entry.generation == job.generation:
                self._inflight.pop(job.key, None)
                self._tokens.pop(job.key, None)
            if job.token.cancelled:
                return
            if failed:
                callback = job.on_failure
                payload = error if error is not None else RuntimeError("未知失败")
            else:
                callback = job.on_success
                payload = value
        if callback is None:
            return
        self._pump.post(lambda: callback(payload))
