"""流程编排：controller 是唯一调用 `CommandRunner` 的地方。

设计对应 `REFACTOR_PLAN.md` §7：

- 用户动作 `blocking=True`，已有任务时 runner 返回 None，界面只提示
  “正在执行上一条命令”；内部后续任务（登录后的 users/backups、备份后的列表、
  info）用 `blocking=False` 排在同一条串行 lane 上。
- 所有 I/O 回调先回投 `QueuePump`，controller 只在主线程写 `Store`；
  本模块不导入 Qt。
- 每个任务带 `(target_key, generation)`，切目标/登出/恢复之后迟到的结果
  由 `_complete` 静默丢弃。
- 同一 `TaskKey` 已在 `state.inflight` 时不重复登记；generation 由这里递增。

目标切换时 runner 的 `close()` 会连带关闭共享的 `QueuePump`，而 C5 的 30ms
定时器持有同一个 pump，所以这里用 `runner.set_target(new_key)` 作废旧代际、
沿用同一条 lane（行为上等价于“关旧 runner、换新 runner”，且不会让 pump 失效）。
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Callable, Sequence

import gui_config
import parsing
import server_config
import service_plan

from .domain import commands, reducers, rules
from .domain.facts import ForegroundPhase, ForegroundSession, HostConfig
from .domain.state import (
    AppState,
    LoginPrompt,
    Notice,
    NoticeTone,
    PageId,
    Phase,
    TaskKey,
)
from .domain.target import (
    ConnectionKind,
    Endpoint,
    Target,
    TargetError,
    resolve_target,
)
from .infra.errors import CommandError, ErrorKind
from .infra.gateway import CliGateway
from .infra.persistence import GuiConfigRepository
from .infra.runner import CancelToken, CommandRunner, QueuePump
from .infra.serve import ServeHandle
from .infra.ssh import TRANSPORT_EXIT
from .infra.transport import SshTransport, Transport
from .store import Store

BUSY_TEXT = "正在执行上一条命令"

# 列表相关的内部后续任务；登录成功、身份刷新、备份成功后都按这个顺序排队。
_LIST_TASKS = (TaskKey.USERS, TaskKey.BACKUPS)


def _failure_of(error: BaseException) -> parsing.Failure:
    """把任意异常归一成可直接展示的 Failure；CommandError 原样透传。"""
    if isinstance(error, CommandError):
        return error.failure
    return parsing.Failure("未知错误", str(error) or "未知错误")


def _reset_after_restore(state: AppState, notice: Notice) -> AppState:
    """恢复备份后的整块清态；`target_changed` 对同一个 target 是空操作，
    所以这里用等价的纯函数 reducer（允许，见任务约定）。"""
    return replace(
        state,
        hosts={},
        identity=None,
        users=(),
        backups=(),
        selected=None,
        selected_backup=None,
        foreground=None,
        inflight={},
        login=None,
        notice=notice,
        info_error=None,
    )


class Controller:
    """把领域 reducer、CLI 网关和线程回投装配成唯一的管理流程。"""

    def __init__(
        self,
        *,
        target: Target,
        transport: Transport,
        config: gui_config.Config,
        config_path: Path,
        transport_factory: Callable[[Target], Transport],
        clock: Callable[[], datetime] = datetime.now,
        pump: QueuePump | None = None,
    ) -> None:
        self._target = target
        self._transport = transport
        self._gateway = CliGateway(transport)
        self._config = config
        self._config_path = Path(config_path)
        self._transport_factory = transport_factory
        self._clock = clock
        self._pump = pump if pump is not None else QueuePump()
        self._runner = CommandRunner(target.key, self._pump)
        self._store = Store(AppState(target=target))
        self._generation: dict[TaskKey, int] = {}
        self._pending: Callable[[], None] | None = None
        self._serve_handle: ServeHandle | None = None
        self._serve_epoch = 0
        self._stopping_foreground = False
        self._shutdown = False

    # ---- 只读接口 -----------------------------------------------------

    @property
    def state(self) -> AppState:
        return self._store.state

    @property
    def config(self) -> gui_config.Config:
        """controller 当前持有的完整 GUI 配置（local + ssh 两段都可用）。"""
        return self._config

    @property
    def service_user(self) -> str:
        """安装/linger 命令展示用的用户名；远端未连接时为空串。"""
        if not self._store.state.target.remote:
            return service_plan.current_user()
        transport = self._transport
        if isinstance(transport, SshTransport):
            return transport.remote_user or ""
        return ""

    @property
    def pump(self) -> QueuePump:
        return self._pump

    def subscribe(self, fn: Callable[[AppState], None]) -> Callable[[], None]:
        return self._store.subscribe(fn)

    # ---- 页面/提示 ----------------------------------------------------

    def set_page(self, page: PageId | str) -> None:
        self._store.update(lambda state: reducers.set_page(state, page))

    def dismiss_notice(self) -> None:
        self._store.update(reducers.notice_dismissed)

    def show_help(self) -> None:
        gateway = self._gateway

        def work(cancel: CancelToken) -> str:
            return gateway.help(cancel)

        self._submit(
            TaskKey.HELP,
            work,
            blocking=True,
            on_success=self._help_loaded,
        )

    def _help_loaded(self, text: str) -> None:
        self._notice(
            Notice(
                title="命令行提示",
                text="完整参数如下：",
                details=text,
                dialog=True,
                tone=NoticeTone.INFO,
            )
        )

    # ---- 启动 ---------------------------------------------------------

    def bootstrap(self) -> None:
        if self._store.state.phase is not Phase.BOOTING:
            return
        if not self._queue_info(blocking=False):
            # runner 已关闭或已有 info 在跑：不把界面永久卡在 BOOTING。
            self._mark_ready()

    # ---- 登录 ---------------------------------------------------------

    def ensure_login(self, then: Callable[[], None] | None = None) -> bool:
        """已登录→立即执行 then 并返回 True；否则弹登录提示并暂存 then。"""
        if self._closing():
            return False
        state = self._store.state
        if state.identity is not None:
            if then is not None:
                self._run_action(then)
            return True
        if then is not None:
            self._pending = then
        prompt = LoginPrompt(username=self._last_username())
        self._store.update(lambda current: reducers.login_prompt_set(current, prompt))
        return False

    def _ensure_login_for(self, action: Callable[[], None]) -> bool:
        """已登录直接放行；未登录把 action 留作 pending，避免再触发它一次。"""
        if self._store.state.identity is not None:
            return True
        return self.ensure_login(then=action)

    def login(
        self,
        username: str,
        password: str,
        then: Callable[[], None] | None = None,
    ) -> None:
        if then is not None:
            self._pending = then
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            # 密码只在参数里交给 gateway（最终走 stdin），不落日志、不进 notice。
            gateway.login(username, password, cancel)

        self._submit(
            TaskKey.LOGIN,
            work,
            blocking=True,
            on_success=lambda _value: self._queue_identity(),
            on_failure=lambda error: self._login_failed(error, username),
        )

    def setup_owner(self, username: str, password: str) -> None:
        """首次创建 Owner；成功后预填登录 sheet，并重读 info。"""
        if self._closing():
            return
        verdict = rules.action_verdict(
            self._store.state, rules.ActionId.SETUP_OWNER, self._now()
        )
        if not verdict.enabled:
            self._notice(
                verdict.tooltip or verdict.reason.value,
                tone=(
                    NoticeTone.ERROR
                    if verdict.reason is rules.ActionReason.BUSY
                    else NoticeTone.WARNING
                ),
            )
            return
        host = rules.host_config(self._store.state)
        listen = host.listen if host is not None else ""
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            gateway.setup(username, password, listen=listen, cancel=cancel)

        self._submit(
            TaskKey.SETUP,
            work,
            blocking=True,
            on_success=lambda _value: self._setup_finished(username),
            on_failure=self._fail,
        )

    def _setup_finished(self, username: str) -> None:
        self._store.update(
            lambda state: reducers.login_prompt_set(
                state, LoginPrompt(username=username)
            )
        )
        self._notice("Owner 已创建，请登录", tone=NoticeTone.SUCCESS)
        self._queue_info(blocking=False)

    def _login_failed(self, error: BaseException, username: str) -> None:
        kind = error.kind if isinstance(error, CommandError) else ErrorKind.UNKNOWN
        if kind is ErrorKind.CANCELLED:
            return
        if kind in (
            ErrorKind.TIMEOUT,
            ErrorKind.TRANSPORT,
            ErrorKind.MISSING_BINARY,
            ErrorKind.USAGE,
            ErrorKind.PARSE,
        ):
            self._fail(error)
            return
        if kind is ErrorKind.FORBIDDEN:
            # CLI 登录本身就拒绝非 Admin/Owner；清态后给出与 whoami 相同的提示。
            self._auth_expired("没有管理权限")
            return
        # 密码错误（CLI 退出码 1）与 AUTH 都回到登录 sheet 就地显示，不重开弹窗。
        failure = _failure_of(error)
        prompt = LoginPrompt(username=username, error=failure.message)
        self._store.update(lambda state: reducers.login_prompt_set(state, prompt))

    def _queue_identity(self) -> bool:
        gateway = self._gateway

        def work(cancel: CancelToken) -> parsing.Identity:
            return gateway.whoami(cancel)

        return self._submit(
            TaskKey.IDENTITY,
            work,
            blocking=False,
            on_success=self._identity_loaded,
            on_failure=self._fail,
        )

    def _identity_loaded(self, identity: parsing.Identity) -> None:
        if not identity.is_admin:
            self._pending = None
            self._auth_expired("没有管理权限")
            return
        self._store.update(lambda state: reducers.identity_loaded(state, identity))
        self._save_username(identity.username)
        self._queue_users(blocking=False)
        self._queue_backups(blocking=False)
        self._maybe_run_pending()

    def logout(self) -> None:
        if self._store.state.identity is None:
            return
        gateway = self._gateway
        self._submit(
            TaskKey.LOGOUT,
            lambda cancel: gateway.logout(cancel),
            blocking=True,
            on_success=self._logout_finished,
        )

    def _logout_finished(self, _value: object = None) -> None:
        self._pending = None
        self._store.update(lambda state: reducers.auth_expired(state, ""))
        self._notice("已退出登录", tone=NoticeTone.SUCCESS)

    # ---- 账户列表 -----------------------------------------------------

    def refresh_users(self) -> None:
        if self._closing():
            return
        identity = self._store.state.identity
        if identity is None or not identity.is_admin:
            return
        self._queue_users(blocking=True)

    def _queue_users(self, *, blocking: bool) -> bool:
        identity = self._store.state.identity
        if identity is None or not identity.is_admin:
            return False
        gateway = self._gateway

        def work(cancel: CancelToken) -> list[parsing.User]:
            return gateway.users(cancel)

        return self._submit(
            TaskKey.USERS,
            work,
            blocking=blocking,
            on_success=self._users_loaded,
            on_failure=self._list_failed,
        )

    def _users_loaded(self, users: list[parsing.User]) -> None:
        self._store.update(lambda state: reducers.users_loaded(state, users))
        self._maybe_run_pending()

    # ---- 备份列表 -----------------------------------------------------

    def refresh_backups(self) -> None:
        if self._closing():
            return
        identity = self._store.state.identity
        if identity is None or not identity.is_owner:
            return
        self._queue_backups(blocking=True)

    def _queue_backups(self, *, blocking: bool) -> bool:
        identity = self._store.state.identity
        if identity is None or not identity.is_owner:
            return False
        gateway = self._gateway

        def work(cancel: CancelToken) -> list[parsing.Backup]:
            return gateway.backups(cancel)

        return self._submit(
            TaskKey.BACKUPS,
            work,
            blocking=blocking,
            on_success=self._backups_loaded,
            on_failure=self._list_failed,
        )

    def _backups_loaded(self, backups: list[parsing.Backup]) -> None:
        self._store.update(lambda state: reducers.backups_loaded(state, backups))
        self._maybe_run_pending()

    def _list_failed(self, error: BaseException) -> None:
        self._fail(error)
        self._maybe_run_pending()

    # ---- 选中 ---------------------------------------------------------

    def select_user(self, username: str | None) -> None:
        self._store.update(lambda state: reducers.select_user(state, username))

    def select_backup(self, name: str | None) -> None:
        self._store.update(lambda state: reducers.select_backup(state, name))

    # ---- 账户动作 -----------------------------------------------------

    def add_user(
        self, username: str, password: str, groups: Sequence[str] = ()
    ) -> None:
        if not self._ensure_login_for(
            lambda: self.add_user(username, password, groups)
        ):
            return
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            gateway.user_add(username, password, groups, cancel)

        self._submit(
            TaskKey.USER_ACTION,
            work,
            blocking=True,
            on_success=lambda _value: self._user_action_finished("账户已创建"),
        )

    def reset_password(self, username: str, password: str) -> None:
        if not self._ensure_login_for(
            lambda: self.reset_password(username, password)
        ):
            return
        identity = self._store.state.identity
        own_password = identity is not None and identity.username == username
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            gateway.user_reset_password(username, password, cancel)

        self._submit(
            TaskKey.USER_ACTION,
            work,
            blocking=True,
            on_success=lambda _value: self._password_reset(username, own_password),
        )

    def _password_reset(self, username: str, own_password: bool) -> None:
        if own_password:
            self._pending = None
            self._store.update(lambda state: reducers.auth_expired(state, ""))
            self._notice("密码已重置，请重新登录", tone=NoticeTone.SUCCESS)
            return
        self._notice("密码已重置，旧会话已吊销", tone=NoticeTone.SUCCESS)
        # 账户变更后重新读身份，身份成功会顺带刷新 users/backups（基线 §9.10）。
        if self._store.state.identity is not None:
            self._queue_identity()

    def set_user_enabled(self, username: str, enabled: bool) -> None:
        action = "启用" if enabled else "禁用"
        if not self._ensure_login_for(
            lambda: self.set_user_enabled(username, enabled)
        ):
            return
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            gateway.user_enable(username, enabled=enabled, cancel=cancel)

        self._submit(
            TaskKey.USER_ACTION,
            work,
            blocking=True,
            on_success=lambda _value: self._user_action_finished(
                f"已{action}"
            ),
        )

    def change_group(self, username: str, group: str, add: bool) -> None:
        if not self._ensure_login_for(
            lambda: self.change_group(username, group, add)
        ):
            return
        gateway = self._gateway
        action = "授予" if add else "撤销"

        def work(cancel: CancelToken) -> None:
            if add:
                gateway.user_grant(username, group, cancel)
            else:
                gateway.user_revoke(username, group, cancel)

        self._submit(
            TaskKey.USER_ACTION,
            work,
            blocking=True,
            on_success=lambda _value: self._user_action_finished(
                f"已{action} {group}"
            ),
        )

    def delete_user(self, username: str) -> None:
        if not self._ensure_login_for(lambda: self.delete_user(username)):
            return
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            gateway.user_delete(username, cancel)

        self._submit(
            TaskKey.USER_ACTION,
            work,
            blocking=True,
            on_success=lambda _value: self._user_action_finished("账户已删除"),
        )

    def _user_action_finished(self, message: str) -> None:
        self._notice(message, tone=NoticeTone.SUCCESS)
        # 账户变更后重新读身份，身份成功会顺带刷新 users/backups。
        if self._store.state.identity is not None:
            self._queue_identity()

    # ---- 服务 ---------------------------------------------------------

    def start_service(self) -> None:
        if self._closing():
            return
        state = self._store.state
        if rules.is_busy(state):
            self._notice(BUSY_TEXT, tone=NoticeTone.ERROR)
            return
        host = rules.host_config(state)
        if host is not None and host.service.installed:
            if self._serve_handle is not None or state.foreground is not None:
                self._stop_foreground(wait=True, timeout=5.0)
            gateway = self._gateway
            self._submit(
                TaskKey.SERVICE,
                lambda cancel: gateway.service("start", cancel=cancel),
                blocking=True,
                on_success=lambda _value: self._service_finished("服务已启动"),
                on_failure=self._service_failed,
            )
            return
        if state.foreground is not None or self._serve_handle is not None:
            self._notice("服务已经在运行", tone=NoticeTone.ERROR)
            return
        self._start_foreground()

    def stop_service(self) -> None:
        if self._closing():
            return
        state = self._store.state
        if rules.is_busy(state):
            self._notice(BUSY_TEXT, tone=NoticeTone.ERROR)
            return
        if state.foreground is not None:
            if state.foreground.phase is ForegroundPhase.STOPPING:
                self._notice("正在停止服务", tone=NoticeTone.WARNING)
                return
        host = rules.host_config(state)
        if host is not None and host.service.installed:
            if self._serve_handle is not None or state.foreground is not None:
                self._stop_foreground(wait=True, timeout=5.0)
            gateway = self._gateway
            self._submit(
                TaskKey.SERVICE,
                lambda cancel: gateway.service("stop", cancel=cancel),
                blocking=True,
                on_success=lambda _value: self._service_finished("服务已停止"),
                on_failure=self._service_failed,
            )
            return
        if self._serve_handle is None and state.foreground is None:
            self._notice("服务没有在运行", tone=NoticeTone.ERROR)
            return
        self._stop_foreground(wait=False)

    def restart_service(self) -> None:
        if self._closing():
            return
        state = self._store.state
        if rules.is_busy(state):
            self._notice(BUSY_TEXT, tone=NoticeTone.ERROR)
            return
        host = rules.host_config(state)
        if host is None or not host.service.installed:
            self._notice("先安装 systemd 服务", tone=NoticeTone.ERROR)
            return
        if self._serve_handle is not None or state.foreground is not None:
            self._stop_foreground(wait=True, timeout=5.0)
        gateway = self._gateway
        self._submit(
            TaskKey.SERVICE,
            lambda cancel: gateway.service("restart", cancel=cancel),
            blocking=True,
            on_success=lambda _value: self._service_finished("服务已重启"),
            on_failure=self._service_failed,
        )

    def install_service(self, options: dict[str, object]) -> None:
        if self._closing():
            return
        if str(options.get("scope", "user")) != "user":
            # 系统级安装只生成可复制命令，GUI 不提权、不执行。
            self._notice("系统级安装需要手动执行命令", tone=NoticeTone.WARNING)
            return
        enable = bool(options.get("enable", False))
        force = bool(options.get("force", False))
        start = bool(options.get("start", False))
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            gateway.service("install", enable=enable, force=force, cancel=cancel)

        self._submit(
            TaskKey.INSTALL,
            work,
            blocking=True,
            on_success=lambda _value: self._install_finished(start),
            on_failure=self._service_failed,
        )

    def _install_finished(self, start: bool) -> None:
        if start:
            gateway = self._gateway
            if self._submit(
                TaskKey.SERVICE,
                lambda cancel: gateway.service("start", cancel=cancel),
                blocking=False,
                on_success=lambda _value: self._service_finished("服务已启动"),
                on_failure=self._service_failed,
            ):
                return
        self._notice("服务已安装，尚未启动", tone=NoticeTone.SUCCESS)
        self._queue_info(blocking=False)

    def update_service(self, options: dict[str, object]) -> None:
        if self._closing():
            return
        if str(options.get("scope", "user")) != "user":
            self._notice("系统级服务需要手动更新", tone=NoticeTone.WARNING)
            return
        enable = bool(options.get("enable", False))
        start = bool(options.get("start", False))
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            gateway.service("update", enable=enable, cancel=cancel)

        self._submit(
            TaskKey.UPDATE,
            work,
            blocking=True,
            on_success=lambda _value: self._update_finished(start),
            on_failure=self._service_failed,
        )

    def _update_finished(self, start: bool) -> None:
        if start:
            gateway = self._gateway
            if self._submit(
                TaskKey.SERVICE,
                lambda cancel: gateway.service("restart", cancel=cancel),
                blocking=False,
                on_success=lambda _value: self._service_finished("服务已重启"),
                on_failure=self._service_failed,
            ):
                return
        self._notice(
            "systemd unit 已更新；未启动或重启服务。", tone=NoticeTone.SUCCESS
        )
        self._queue_info(blocking=False)

    def uninstall_service(self) -> None:
        if self._closing():
            return
        gateway = self._gateway
        self._submit(
            TaskKey.UNINSTALL,
            lambda cancel: gateway.service("uninstall", cancel=cancel),
            blocking=True,
            on_success=lambda _value: self._uninstall_finished(),
            on_failure=self._service_failed,
        )

    def _uninstall_finished(self) -> None:
        self._notice("服务已卸载，数据目录未改动", tone=NoticeTone.SUCCESS)
        self._queue_info(blocking=False)

    def _service_finished(self, message: str) -> None:
        # 不写任何乐观状态；成功只重读 info（见 §7：“服务命令成功后只 INFO”）。
        self._notice(message, tone=NoticeTone.SUCCESS)
        self._queue_info(blocking=False)

    def _service_failed(self, error: BaseException) -> None:
        kind = error.kind if isinstance(error, CommandError) else ErrorKind.UNKNOWN
        self._fail(error)
        if kind not in (ErrorKind.AUTH, ErrorKind.TRANSPORT, ErrorKind.CANCELLED):
            # 服务命令失败先刷新 info，界面不能停在旧状态。
            self._queue_info(blocking=False)

    # ---- 前台 serve ---------------------------------------------------

    def _start_foreground(self) -> None:
        if self._closing():
            return
        state = self._store.state
        if state.foreground is not None or self._serve_handle is not None:
            self._notice("服务已经在运行", tone=NoticeTone.ERROR)
            return
        if rules.is_busy(state):
            self._notice(BUSY_TEXT, tone=NoticeTone.ERROR)
            return
        self._serve_epoch += 1
        epoch = self._serve_epoch
        target_key = state.target.key
        gateway = self._gateway

        def on_line(line: str) -> None:
            self._pump.post(lambda: self._serve_line(epoch, target_key, line))

        def on_exit(code: int) -> None:
            self._pump.post(lambda: self._serve_exit(epoch, target_key, code))

        try:
            handle = gateway.serve(on_line=on_line, on_exit=on_exit)
        except CommandError as exc:
            self._fail(exc)
            return
        except OSError as exc:
            self._notice(
                Notice(
                    title="chat-deepseek",
                    text=str(exc),
                    dialog=True,
                    tone=NoticeTone.ERROR,
                )
            )
            return
        self._serve_handle = handle
        self._stopping_foreground = False
        session = ForegroundSession(
            target_key=target_key, phase=ForegroundPhase.STARTING
        )
        self._store.update(
            lambda current: reducers.foreground_updated(current, session)
        )

    def _serve_line(self, epoch: int, target_key: str, line: str) -> None:
        if self._closing() or epoch != self._serve_epoch:
            return
        state = self._store.state
        if state.target.key != target_key:
            return
        current = state.foreground
        if current is None or current.target_key != target_key:
            current = ForegroundSession(target_key=target_key)
        event = parsing.parse_serve_event(line)
        phase = current.phase
        address = current.address
        url = current.url
        if event.kind == "listening":
            phase = ForegroundPhase.RUNNING
            address = event.value
        elif event.kind == "url":
            phase = ForegroundPhase.RUNNING
            url = event.value
        elif event.kind == "stopping":
            phase = ForegroundPhase.STOPPING
        updated = current.with_tail(current.tail + (line,)).with_phase(
            phase, address=address, url=url
        )
        self._store.update(
            lambda state: reducers.foreground_updated(state, updated)
        )

    def _serve_exit(self, epoch: int, target_key: str, code: int) -> None:
        if self._closing() or epoch != self._serve_epoch:
            return
        state = self._store.state
        if state.target.key != target_key:
            return
        current = state.foreground
        tail = current.tail if current is not None else ()
        was_stopping = self._stopping_foreground
        self._serve_handle = None
        self._stopping_foreground = False
        self._serve_epoch += 1
        self._store.update(
            lambda state: reducers.foreground_updated(state, None)
        )
        if was_stopping:
            self._notice("服务已停止", tone=NoticeTone.SUCCESS)
            return
        if code == 0:
            return
        failure = parsing.explain_serve_failure(tail, code)
        if state.target.remote and code == TRANSPORT_EXIT:
            self._notice(
                Notice(
                    title="SSH 连接失败",
                    text="远端 serve 会话已断开；远程常驻请安装 systemd 服务。",
                    details="\n".join(tail).strip(),
                    dialog=True,
                    tone=NoticeTone.ERROR,
                )
            )
            return
        self._notice(
            Notice(
                title=failure.title,
                text=failure.message,
                details=failure.details or "",
                dialog=True,
                tone=NoticeTone.ERROR,
            )
        )

    def _stop_foreground(self, *, wait: bool, timeout: float = 5.0) -> None:
        handle = self._serve_handle
        state = self._store.state
        if handle is None:
            if state.foreground is not None:
                self._store.update(
                    lambda current: reducers.foreground_updated(current, None)
                )
            return
        self._stopping_foreground = True
        current = state.foreground
        if current is None:
            current = ForegroundSession(target_key=state.target.key)
        stopping = current.with_phase(ForegroundPhase.STOPPING)
        self._store.update(
            lambda state: reducers.foreground_updated(state, stopping)
        )
        try:
            handle.stop(wait=wait, timeout=timeout)
        except Exception:  # noqa: BLE001 - 停止失败交给 on_exit/兜底
            pass

    # ---- 备份 ---------------------------------------------------------

    def backup_now(self) -> None:
        if not self._check_backup_action(rules.ActionId.BACKUP_NOW):
            return
        if not self._ensure_login_for(self.backup_now):
            return
        if not self._check_backup_action(rules.ActionId.BACKUP_NOW):
            return
        gateway = self._gateway
        self._submit(
            TaskKey.BACKUP,
            lambda cancel: gateway.backup_create(None, cancel),
            blocking=True,
            on_success=self._backup_finished,
            on_failure=self._fail,
        )

    def backup_as(self, path: str) -> None:
        if not self._check_backup_action(rules.ActionId.BACKUP_AS):
            return
        if not self._ensure_login_for(lambda: self.backup_as(path)):
            return
        if not self._check_backup_action(rules.ActionId.BACKUP_AS):
            return
        gateway = self._gateway
        self._submit(
            TaskKey.BACKUP,
            lambda cancel: gateway.backup_create(path, cancel),
            blocking=True,
            on_success=self._backup_finished,
            on_failure=self._fail,
        )

    def _check_backup_action(self, action: rules.ActionId) -> bool:
        verdict = rules.action_verdict(self._store.state, action, self._now())
        if verdict.enabled:
            return True
        self._notice(
            verdict.tooltip or verdict.reason.value,
            tone=(
                NoticeTone.ERROR
                if verdict.reason is rules.ActionReason.BUSY
                else NoticeTone.WARNING
            ),
        )
        return False

    def _backup_finished(self, _path: str | None) -> None:
        self._notice("备份完成", tone=NoticeTone.SUCCESS)
        # 修复现状“备份成功后列表不刷新”：成功立即重读备份列表。
        self._queue_backups(blocking=False)

    def restore_backup(self, name: str) -> None:
        if self._closing():
            return
        verdict = rules.action_verdict(
            self._store.state, rules.ActionId.RESTORE, self._now()
        )
        if not verdict.enabled:
            if verdict.reason is rules.ActionReason.NO_BACKUP_SELECTED:
                self._notice(verdict.reason.value, tone=NoticeTone.WARNING)
            else:
                self._notice(
                    verdict.tooltip or verdict.reason.value,
                    tone=NoticeTone.WARNING,
                )
            return
        if not self._ensure_login_for(lambda: self.restore_backup(name)):
            return
        gateway = self._gateway
        self._submit(
            TaskKey.RESTORE,
            lambda cancel: gateway.backup_restore(name, cancel),
            blocking=True,
            on_success=lambda _value: self._restore_finished(name),
            on_failure=self._fail,
        )

    def _restore_finished(self, name: str) -> None:
        stamp = parsing.parse_backup_time(name)
        label = stamp.strftime("%Y-%m-%d %H:%M:%S") if stamp else name
        notice = Notice(
            text=f"备份已恢复（{label}），请重新登录并启动服务",
            tone=NoticeTone.SUCCESS,
        )
        self._pending = None
        self._serve_handle = None
        self._serve_epoch += 1
        self._stopping_foreground = False
        self._store.update(lambda state: _reset_after_restore(state, notice))
        # 恢复后旧代际全部作废，再按新库重读 info。
        self._invalidate_runner()
        self._queue_info(blocking=False)

    # ---- 设置 ---------------------------------------------------------

    def test_connection(self, endpoint: Endpoint) -> None:
        if self._closing():
            return
        try:
            target = resolve_target(endpoint)
        except TargetError as exc:
            self._notice(
                Notice(
                    title="chat-deepseek",
                    text=str(exc),
                    dialog=True,
                    tone=NoticeTone.ERROR,
                )
            )
            return
        try:
            temporary = self._transport_factory(target)
        except Exception as exc:  # noqa: BLE001 - 构造失败直接提示
            self._notice(
                Notice(
                    title="chat-deepseek",
                    text=str(exc),
                    dialog=True,
                    tone=NoticeTone.ERROR,
                )
            )
            return

        def work(cancel: CancelToken) -> None:
            del cancel
            try:
                temporary.verify(20.0)
            finally:
                temporary.close()

        if not self._submit(
            TaskKey.CONFIG,
            work,
            blocking=True,
            on_success=lambda _value: self._notice(
                "连接正常", tone=NoticeTone.SUCCESS
            ),
            on_failure=self._connection_failed,
        ):
            try:
                temporary.close()
            except Exception:  # noqa: BLE001
                pass

    def _connection_failed(self, error: BaseException) -> None:
        """测试连接失败只提示；不能因为临时目标而清掉当前目标的登录态。"""
        kind = error.kind if isinstance(error, CommandError) else ErrorKind.UNKNOWN
        if kind is ErrorKind.CANCELLED:
            return
        failure = _failure_of(error)
        if kind is ErrorKind.TIMEOUT:
            self._notice(
                Notice(
                    text=failure.message,
                    details=failure.details or "",
                    tone=NoticeTone.WARNING,
                )
            )
            return
        self._notice(
            Notice(
                title=failure.title,
                text=failure.message,
                details=failure.details or "",
                dialog=True,
                tone=NoticeTone.ERROR,
            )
        )

    def apply_target(self, endpoint: Endpoint) -> None:
        if self._closing():
            return
        state = self._store.state
        try:
            new_target = resolve_target(endpoint)
        except TargetError as exc:
            self._notice(
                Notice(
                    title="chat-deepseek",
                    text=str(exc),
                    dialog=True,
                    tone=NoticeTone.ERROR,
                )
            )
            return
        new_config = self._config_for_endpoint(endpoint)
        if new_target.key == state.target.key:
            try:
                GuiConfigRepository(self._config_path).save(new_config)
            except OSError as exc:
                self._notice(
                    Notice(
                        title="保存设置失败",
                        text=f"无法写入 config.gui.json：{exc}",
                        dialog=True,
                        tone=NoticeTone.ERROR,
                    )
                )
                return
            self._config = new_config
            self._notice("设置已保存", tone=NoticeTone.SUCCESS)
            return
        if rules.is_busy(state):
            self._notice(BUSY_TEXT, tone=NoticeTone.ERROR)
            return
        try:
            new_transport = self._transport_factory(new_target)
        except Exception as exc:  # noqa: BLE001 - 保留旧目标
            self._notice(
                Notice(
                    title="chat-deepseek",
                    text=str(exc),
                    dialog=True,
                    tone=NoticeTone.ERROR,
                )
            )
            return

        old_target = state.target
        old_transport = self._transport
        old_serve = self._serve_handle
        had_identity = state.identity is not None
        # 切换期间旧前台的退出算主动停止；保存配置失败时立刻复位。
        self._stopping_foreground = old_serve is not None
        repository = GuiConfigRepository(self._config_path)

        def work(cancel: CancelToken) -> None:
            # 1) 先落本地配置：失败时旧前台、旧通道、旧目标全部原封不动。
            repository.save(new_config)
            # 2) 保存成功后才停旧前台、尽力 logout、关旧通道；后面三步 best-effort。
            if old_serve is not None:
                try:
                    old_serve.stop(wait=True, timeout=8.0)
                except Exception:  # noqa: BLE001 - 旧会话已经不可控
                    pass
            if had_identity:
                try:
                    spec = replace(commands.logout(old_target), timeout=5.0)
                    old_transport.run(spec, cancel)
                except Exception:  # noqa: BLE001 - 登出失败只能等过期
                    pass
            try:
                old_transport.close()
            except Exception:  # noqa: BLE001
                pass

        def success(_value: object) -> None:
            # 旧代际全部作废；沿用 runner/pump，避免 close() 关掉共享的泵。
            self._invalidate_runner()
            self._transport = new_transport
            self._gateway = CliGateway(new_transport)
            self._config = new_config
            self._serve_handle = None
            self._serve_epoch += 1
            self._stopping_foreground = False
            self._pending = None
            self._store.update(
                lambda current: reducers.target_changed(current, new_target)
            )
            self._notice("连接已切换，请重新登录", tone=NoticeTone.SUCCESS)
            self._queue_info(blocking=False)

        def failure(error: BaseException) -> None:
            self._stopping_foreground = False
            try:
                new_transport.close()
            except Exception:  # noqa: BLE001
                pass
            if isinstance(error, CommandError):
                failure_value = error.failure
                self._notice(
                    Notice(
                        title=failure_value.title,
                        text=failure_value.message,
                        details=failure_value.details or "",
                        dialog=True,
                        tone=NoticeTone.ERROR,
                    )
                )
            else:
                self._notice(
                    Notice(
                        title="保存设置失败",
                        text=f"无法写入 config.gui.json：{error}",
                        dialog=True,
                        tone=NoticeTone.ERROR,
                    )
                )

        if not self._submit(
            TaskKey.CONFIG,
            work,
            blocking=True,
            on_success=success,
            on_failure=failure,
        ):
            try:
                new_transport.close()
            except Exception:  # noqa: BLE001
                pass

    def migrate_legacy_backup_dir(self, legacy: str) -> None:
        """把 v1 `config.gui.json` 的备份地址写进目标主机的 `config.json`。"""
        if self._closing() or not legacy:
            return
        state = self._store.state
        if state.target.remote:
            # v1 的备份地址是本机路径，对远端没有意义。
            return
        host = rules.host_config(state)
        if host is None:
            return
        if host.backup_dir != server_config.default_backup_dir(host.data_dir):
            # 用户已经自定义过备份地址，不要覆盖。
            return
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            gateway.config_set("backup_dir", legacy, cancel)

        self._submit(
            TaskKey.CONFIG,
            work,
            blocking=False,
            on_success=lambda _value: self._legacy_backup_migrated(),
            on_failure=self._legacy_backup_ignored,
        )

    def _legacy_backup_migrated(self) -> None:
        self._notice(
            "已把旧备份地址写入 config.json", tone=NoticeTone.SUCCESS
        )
        self._queue_info(blocking=False)

    def _legacy_backup_ignored(self, _error: BaseException) -> None:
        # 启动时的迁移失败不打断用户；下次启动 info 回填后还能再试。
        return

    def save_server_config(self, values: dict[str, str]) -> None:
        if self._closing():
            return
        host = rules.host_config(self._store.state)
        if host is None:
            self._notice("正在读取目标主机配置…", tone=NoticeTone.WARNING)
            return
        changes = [
            (key, str(values[key]))
            for key in ("backup_dir", "listen", "public_url", "api_origin")
            if key in values and str(values[key]) != getattr(host, key)
        ]
        if not changes:
            self._notice("没有需要保存的修改", tone=NoticeTone.INFO)
            return
        gateway = self._gateway

        def work(cancel: CancelToken) -> None:
            for key, value in changes:
                gateway.config_set(key, value, cancel)

        self._submit(
            TaskKey.CONFIG,
            work,
            blocking=True,
            on_success=lambda _value: self._config_saved(),
            on_failure=self._fail,
        )

    def _config_saved(self) -> None:
        self._notice("设置已保存", tone=NoticeTone.SUCCESS)
        self._queue_info(blocking=False)

    # ---- 关闭 ---------------------------------------------------------

    def shutdown(self) -> None:
        """closing_started → 停前台(≤8s) → logout(5s) → 关通道 → runner → pump。"""
        if self._shutdown:
            return
        self._shutdown = True
        self._pending = None
        self._store.update(reducers.closing_started)

        handle = self._serve_handle
        self._serve_handle = None
        self._stopping_foreground = True
        if handle is not None:
            try:
                handle.stop(wait=True, timeout=8.0)
            except Exception:  # noqa: BLE001 - 关闭时不再上抛
                pass

        state = self._store.state
        if state.identity is not None:
            try:
                spec = replace(commands.logout(state.target), timeout=5.0)
                self._transport.run(spec, None)
            except Exception:  # noqa: BLE001 - 尽力而为
                pass
        try:
            self._transport.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            self._runner.close()
        except Exception:  # noqa: BLE001
            pass
        self._pump.close()

    # ---- 内部 ---------------------------------------------------------

    def _submit(
        self,
        task: TaskKey,
        fn: Callable[[CancelToken], object],
        *,
        blocking: bool,
        on_success: Callable[[object], None] | None = None,
        on_failure: Callable[[BaseException], None] | None = None,
    ) -> bool:
        if self._closing():
            return False
        state = self._store.state
        if task in state.inflight:
            if blocking:
                self._notice(BUSY_TEXT, tone=NoticeTone.ERROR)
            return False
        target_key = state.target.key
        generation = self._generation.get(task, 0) + 1

        def success(value: object) -> None:
            self._complete(
                task, target_key, generation, on_success, value, None
            )

        def failure(error: BaseException) -> None:
            self._complete(
                task, target_key, generation, on_failure, None, error
            )

        token = self._runner.submit(
            task,
            fn,
            on_success=success,
            on_failure=failure,
            blocking=blocking,
        )
        if token is None:
            if blocking and not self._closing():
                self._notice(BUSY_TEXT, tone=NoticeTone.ERROR)
            return False
        self._generation[task] = generation
        self._store.update(
            lambda current: reducers.task_started(
                current, task, target_key=target_key, generation=generation
            )
        )
        return True

    def _complete(
        self,
        task: TaskKey,
        target_key: str,
        generation: int,
        callback: Callable[[object], None] | None,
        value: object,
        error: BaseException | None,
    ) -> None:
        if self._shutdown:
            return
        state = self._store.state
        if state.closing or state.phase is Phase.CLOSING:
            return
        if state.target.key != target_key:
            return
        entry = state.inflight.get(task)
        if entry is None or entry.generation != generation:
            return
        self._store.update(lambda current: reducers.task_finished(current, task))
        if error is not None:
            if callback is not None:
                try:
                    callback(error)
                except Exception as exc:  # noqa: BLE001
                    self._notice(
                        Notice(
                            title="界面错误",
                            text=str(exc),
                            dialog=True,
                            tone=NoticeTone.ERROR,
                        )
                    )
            else:
                self._fail(error)
            return
        if callback is not None:
            try:
                callback(value)
            except Exception as exc:  # noqa: BLE001
                self._notice(
                    Notice(
                        title="界面错误",
                        text=str(exc),
                        dialog=True,
                        tone=NoticeTone.ERROR,
                    )
                )

    def _fail(self, error: BaseException) -> None:
        """统一失败出口；种类映射见任务约定与 `REFACTOR_PLAN.md` §5.4。"""
        kind = error.kind if isinstance(error, CommandError) else ErrorKind.UNKNOWN
        failure = _failure_of(error)
        if kind is ErrorKind.CANCELLED:
            return
        if kind is ErrorKind.AUTH:
            self._auth_expired("登录已失效，请重新登录")
            return
        if kind is ErrorKind.TRANSPORT:
            try:
                self._transport.close()
            except Exception:  # noqa: BLE001
                pass
            self._auth_expired("SSH 连接已断开，请重新登录")
            self._notice(
                Notice(
                    title="SSH 连接失败",
                    text="SSH 连接已断开，请重新登录",
                    details=failure.details or "",
                    dialog=True,
                    tone=NoticeTone.ERROR,
                )
            )
            return
        if kind is ErrorKind.TIMEOUT:
            self._notice(
                Notice(
                    text=failure.message,
                    details=failure.details or "",
                    tone=NoticeTone.WARNING,
                )
            )
            return
        self._notice(
            Notice(
                title=failure.title,
                text=failure.message,
                details=failure.details or "",
                dialog=True,
                tone=NoticeTone.ERROR,
            )
        )

    def _auth_expired(self, message: str) -> None:
        self._pending = None
        self._store.update(lambda state: reducers.auth_expired(state, message))
        self._invalidate_runner()

    def _invalidate_runner(self) -> None:
        try:
            self._runner.set_target(self._store.state.target.key)
        except Exception:  # noqa: BLE001 - runner 已关闭时无需再作废
            pass

    def _queue_info(self, *, blocking: bool) -> bool:
        gateway = self._gateway

        def work(cancel: CancelToken) -> parsing.Info:
            return gateway.info(cancel)

        return self._submit(
            TaskKey.INFO,
            work,
            blocking=blocking,
            on_success=self._info_loaded,
            on_failure=self._info_failed,
        )

    def _info_loaded(self, info: parsing.Info) -> None:
        state = self._store.state
        host = HostConfig.from_info(state.target.key, info)
        self._store.update(lambda current: reducers.facts_loaded(current, host))
        self._mark_ready()

    def _info_failed(self, error: BaseException) -> None:
        failure = _failure_of(error)
        # 保留上一份 HostConfig，只标错误；随后走统一失败出口。
        self._store.update(
            lambda state: reducers.facts_failed(state, failure)
        )
        self._fail(error)
        self._mark_ready()

    def _mark_ready(self) -> None:
        if self._store.state.phase is Phase.BOOTING:
            self._store.update(reducers.booted)

    def _maybe_run_pending(self) -> None:
        if self._pending is None:
            return
        if self._store.state.identity is None:
            return
        state = self._store.state
        for task in (TaskKey.LOGIN, TaskKey.IDENTITY, *_LIST_TASKS):
            if task in state.inflight:
                return
        action = self._pending
        self._pending = None
        self._run_action(action)

    def _run_action(self, action: Callable[[], None]) -> None:
        try:
            action()
        except Exception as exc:  # noqa: BLE001 - 单个回调失败不中断界面
            self._notice(
                Notice(
                    title="界面错误",
                    text=str(exc),
                    dialog=True,
                    tone=NoticeTone.ERROR,
                )
            )

    def _notice(
        self,
        notice: Notice | str,
        *,
        tone: NoticeTone = NoticeTone.INFO,
        details: str = "",
        title: str = "",
        dialog: bool = False,
    ) -> None:
        if self._closing():
            return
        value = (
            notice
            if isinstance(notice, Notice)
            else Notice(
                text=str(notice),
                tone=NoticeTone(tone),
                details=details,
                title=title,
                dialog=dialog,
            )
        )
        self._store.update(
            lambda state: reducers.notice_raised(state, value)
        )

    def _closing(self) -> bool:
        state = self._store.state
        return bool(self._shutdown or state.closing or state.phase is Phase.CLOSING)

    def _now(self) -> datetime:
        return self._clock()

    def _last_username(self) -> str:
        if self._store.state.target.remote:
            return self._config.ssh.username
        return self._config.local.username

    def _save_username(self, username: str) -> None:
        self._config = self._config_with_username(username)
        self._save_config(self._config)

    def _config_with_username(self, username: str) -> gui_config.Config:
        config = self._config
        if self._store.state.target.remote:
            return replace(
                config,
                connection="ssh",
                ssh=replace(config.ssh, username=username),
            )
        return replace(
            config,
            connection="local",
            local=replace(config.local, username=username),
        )

    def _config_for_endpoint(self, endpoint: Endpoint) -> gui_config.Config:
        config = self._config
        kind = (
            "ssh"
            if ConnectionKind(endpoint.kind) is ConnectionKind.SSH
            else "local"
        )
        if kind == "local":
            local = replace(
                config.local,
                binary_dir=endpoint.binary_dir.strip(),
                data_dir=endpoint.data_dir.strip(),
            )
            return replace(config, connection="local", local=local)
        ssh = replace(
            config.ssh,
            host=endpoint.host.strip(),
            binary_dir=endpoint.binary_dir.strip(),
            data_dir=endpoint.data_dir.strip(),
        )
        return replace(config, connection="ssh", ssh=ssh)

    def _save_config(self, config: gui_config.Config) -> None:
        try:
            GuiConfigRepository(self._config_path).save(config)
        except OSError:
            # 用户名写回失败不阻塞登录；下次登录再写。
            pass
