"""执行通道：本机 Popen 与常驻 SSH 两种实现。

界面层不再出现 `if remote`：目标能力、前台会话的停止方式、错误归一化都在
这里。`SshTransport` 内部持有 `SshSession` 自己的锁，常驻通道的握手/哨兵/
here-doc 逻辑保持原样。

契约（与 `REFACTOR_PLAN.md` §5.2 一致）：

- `run(spec, cancel)`：执行一条短命令，返回 `CommandResult`，超时/取消不抛异常。
- `open_serve(spec, on_line=?, on_exit=?)`：启动前台 serve 并返回已启动的
  `ServeHandle`；本地失败（二进制不存在）会抛 `OSError`。
- `verify(timeout=20)`：本机检查二进制存在；远端跑一次握手 + `info`。
- `close()`：释放通道；可重复调用。
"""

from __future__ import annotations

import os
import shlex
import subprocess
import threading
import time
from typing import Callable, Protocol, Sequence

import parsing

from ..domain import commands
from ..domain.commands import CommandSpec
from ..domain.target import Target
from .errors import CommandError, ErrorKind, normalize
from .process import CANCELLED_STDERR, CancelCheck, CommandResult, run_popen
from .serve import ServeHandle, ServerProcess
from .ssh import (
    CONNECT_TIMEOUT,
    DEFAULT_TIMEOUT,
    SERVE_PID_PREFIX,
    SshSession,
    serve_command,
)


class Transport(Protocol):
    target: Target

    def run(
        self, spec: CommandSpec, cancel: CancelCheck | None = None
    ) -> CommandResult: ...

    def open_serve(
        self,
        spec: CommandSpec,
        *,
        on_line: Callable[[str], None] | None = None,
        on_exit: Callable[[int], None] | None = None,
    ) -> ServeHandle: ...

    def verify(self, timeout: float = 20.0) -> None: ...

    def close(self) -> None: ...


class LocalTransport:
    """本机：每条命令一个子进程，前台 serve 由 `ServerProcess` 托管。"""

    def __init__(self, target: Target) -> None:
        self.target = target

    def run(
        self, spec: CommandSpec, cancel: CancelCheck | None = None
    ) -> CommandResult:
        return run_popen(
            (self.target.binary, *spec.argv),
            spec.stdin,
            spec.timeout,
            cancel,
        )

    def open_serve(
        self,
        spec: CommandSpec,
        *,
        on_line: Callable[[str], None] | None = None,
        on_exit: Callable[[int], None] | None = None,
    ) -> ServeHandle:
        handle = ServerProcess(
            (self.target.binary, *spec.argv),
            on_line=on_line or _ignore_line,
            on_exit=on_exit or _ignore_exit,
        )
        handle.start()
        return handle

    def verify(self, timeout: float = 20.0) -> None:
        """本机只检查二进制存在；真正执行时的错误由 run() 归一化。"""
        del timeout
        if not os.path.isfile(self.target.binary):
            raise CommandError(
                ErrorKind.MISSING_BINARY,
                parsing.Failure(
                    "找不到 chat-deepseek",
                    f"这个路径里没有可执行的 chat-deepseek：{self.target.binary}。"
                    "请到设置里重新选择二进制目录。",
                ),
            )

    def close(self) -> None:
        return


class _SshServeProcess(ServerProcess):
    """远端前台 serve：停止时先按 marker PID 发 SIGTERM，再兜底结束本地 ssh。

    `ssh -T` 不分配 pty，只结束本地 ssh 不会让远端 serve 退出；kill 返回 0/1
    （进程已不在）都算停止成功。拿不到 PID 或发不出去时才 terminate ssh。
    """

    def __init__(
        self,
        command: Sequence[str],
        on_line: Callable[[str], None],
        on_exit: Callable[[int], None],
        *,
        terminate_remote: Callable[[int], bool],
        env: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            command,
            on_line=on_line,
            on_exit=on_exit,
            marker=SERVE_PID_PREFIX,
            env=env,
        )
        self._terminate_remote = terminate_remote

    def stop(self, wait: bool = False, timeout: float = 10.0) -> None:
        pid = self.marker_pid
        if pid is None and self.running:
            pid = self._wait_pid(min(5.0, max(0.1, timeout)))
        if pid is not None and self._terminate_remote(pid):
            if wait:
                process = self.process
                if process is not None and process.poll() is None:
                    try:
                        process.wait(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        # 远端没退干净时仍然结束本地 ssh，界面不能卡在停止中。
                        super().stop(wait=True, timeout=timeout)
            return
        super().stop(wait=wait, timeout=timeout)

    def _wait_pid(self, timeout: float) -> int | None:
        """刚启动就点停止时，PID 那一行可能还在路上。"""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.marker_pid is not None:
                return self.marker_pid
            if not self.running:
                return None
            time.sleep(0.05)
        return self.marker_pid


class SshTransport:
    """远端：所有命令走同一个常驻 shell，执行时串行化。"""

    def __init__(
        self,
        target: Target,
        *,
        program: str = "ssh",
        options: Sequence[str] | None = None,
        env: dict[str, str] | None = None,
        connect_timeout: float | None = None,
        command_timeout: float | None = None,
    ) -> None:
        self.target = target
        self._session = SshSession(
            target.host,
            program=program,
            options=options,
            env=env,
            connect_timeout=(
                CONNECT_TIMEOUT if connect_timeout is None else connect_timeout
            ),
            command_timeout=(
                DEFAULT_TIMEOUT if command_timeout is None else command_timeout
            ),
        )
        self._lock = threading.RLock()

    # 只读快照，供设置页展示不引入界面层判断。
    @property
    def session(self) -> SshSession:
        return self._session

    @property
    def remote_user(self) -> str:
        return self._session.remote_user

    @property
    def connected(self) -> bool:
        return self._session.connected

    def run(
        self, spec: CommandSpec, cancel: CancelCheck | None = None
    ) -> CommandResult:
        with self._lock:
            if cancel is not None and cancel.cancelled:
                # SSH 命令执行中无法安全打断（关通道会丢登录态），只在开始前
                # 响应取消；runner 仍会按 generation 丢弃结果。
                return CommandResult(spec.argv, 1, "", CANCELLED_STDERR)
            return self._session.run(
                self.target.binary, spec.argv, spec.stdin, spec.timeout
            )

    def open_serve(
        self,
        spec: CommandSpec,
        *,
        on_line: Callable[[str], None] | None = None,
        on_exit: Callable[[int], None] | None = None,
    ) -> ServeHandle:
        remote = shlex.join([self.target.binary, *spec.argv])
        command = serve_command(
            self.target.host,
            remote,
            program=self._session.program,
            options=self._session.options,
        )
        handle = _SshServeProcess(
            command,
            on_line=on_line or _ignore_line,
            on_exit=on_exit or _ignore_exit,
            terminate_remote=self._terminate_remote,
            env=self._session.env,
        )
        handle.start()
        return handle

    def verify(self, timeout: float = 20.0) -> None:
        """远端只做现有握手（printf ready + id -un），不执行 CLI。

        二进制是否存在由后续 `info` 等命令的 127 归一化为 MISSING_BINARY。
        """
        del timeout  # 握手超时由 SshSession 的 connect_timeout 控制
        try:
            with self._lock:
                self._session.ensure_started()
        except RuntimeError as exc:
            raise CommandError(
                ErrorKind.TRANSPORT,
                parsing.Failure(
                    "SSH 连接失败",
                    f"无法建立到 {self.target.host} 的常驻通道。",
                    str(exc),
                ),
            ) from exc

    def close(self) -> None:
        with self._lock:
            self._session.close()

    # ---- 内部 ---------------------------------------------------------

    def _terminate_remote(self, pid: int) -> bool:
        """按 PID 结束远端 serve；命令走常驻通道，和 serve 的 ssh 是两条连接。"""
        spec = commands.kill_serve(pid)
        with self._lock:
            result = self._session.run(
                spec.argv[0], spec.argv[1:], spec.stdin, spec.timeout
            )
        return result.code in (0, 1)


def _ignore_line(_line: str) -> None:
    return


def _ignore_exit(_code: int) -> None:
    return
