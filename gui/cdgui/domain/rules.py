"""全部派生判断：状态、地址、备份前置条件、按钮 Verdict。

页面和 controller **不得**自己写 `if identity.is_owner` / `if service_active`；
权限、登录态、服务状态、远端能力都在这里回答。`action_verdict` 是表驱动的，
`ActionId` 缺一项会直接抛 `MissingVerdictError`，由测试保证完整性。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable

import parsing
import server_config

from .facts import ForegroundPhase, HostConfig
from .state import AppState, Phase
from .target import Capability, StrEnum


class ActionId(StrEnum):
    START = "start"
    STOP = "stop"
    RESTART = "restart"
    OPEN_PAGE = "open_page"
    INSTALL = "install"
    UPDATE = "update"
    UNINSTALL = "uninstall"
    REFRESH_USERS = "refresh_users"
    ADD_USER = "add_user"
    RESET_PASSWORD = "reset_password"
    TOGGLE_USER = "toggle_user"
    GRANT = "grant"
    REVOKE = "revoke"
    DELETE_USER = "delete_user"
    BACKUP_NOW = "backup_now"
    BACKUP_AS = "backup_as"
    MANAGE_BACKUPS = "manage_backups"
    RESTORE = "restore"
    LOGIN = "login"
    LOGOUT = "logout"
    SETTINGS_SAVE_CONNECTION = "settings_save_connection"
    SETTINGS_APPLY_TARGET = "settings_apply_target"
    SETTINGS_SAVE_SERVER = "settings_save_server"
    TEST_CONNECTION = "test_connection"
    HELP = "help"
    # 基线要求账户页空态有“创建 Owner”入口；列表之外补一个动作。
    SETUP_OWNER = "setup_owner"


class ActionReason(StrEnum):
    OK = "ok"
    CLOSING = "closing"
    BUSY = "busy"
    NOT_INITIALIZED = "not_initialized"
    ALREADY_INITIALIZED = "already_initialized"
    NOT_LOGGED_IN = "not_logged_in"
    ALREADY_LOGGED_IN = "already_logged_in"
    FORBIDDEN = "forbidden"
    NO_SELECTION = "no_selection"
    # RESTORE 专用：reason 直接作为用户文案，避免再映射一次。
    NO_BACKUP_SELECTED = "先选择一个备份"
    ALREADY_RUNNING = "already_running"
    NOT_RUNNING = "not_running"
    STOPPING = "stopping"
    NOT_INSTALLED = "not_installed"
    UNSUPPORTED = "unsupported"
    INFO_PENDING = "info_pending"
    NO_URL = "no_url"
    REMOTE_UNSUPPORTED = "remote_unsupported"


_REASON_TEXT: dict[ActionReason, str] = {
    ActionReason.OK: "",
    ActionReason.CLOSING: "正在关闭窗口",
    ActionReason.BUSY: "正在执行上一条命令",
    ActionReason.NOT_INITIALIZED: "数据目录还没有初始化",
    ActionReason.ALREADY_INITIALIZED: "数据目录已经初始化",
    ActionReason.NOT_LOGGED_IN: "请先登录",
    ActionReason.ALREADY_LOGGED_IN: "已经登录",
    ActionReason.FORBIDDEN: "需要 Owner 权限",
    ActionReason.NO_SELECTION: "",
    ActionReason.NO_BACKUP_SELECTED: "先选择一个备份",
    ActionReason.ALREADY_RUNNING: "服务已经在运行",
    ActionReason.NOT_RUNNING: "服务没有在运行",
    ActionReason.STOPPING: "正在停止服务",
    ActionReason.NOT_INSTALLED: "先安装 systemd 服务",
    ActionReason.UNSUPPORTED: "当前平台不支持 systemd 服务",
    ActionReason.INFO_PENDING: "正在读取目标主机配置…",
    ActionReason.NO_URL: "没有可打开的地址",
    ActionReason.REMOTE_UNSUPPORTED: "远端不支持这个操作",
}


@dataclass(frozen=True)
class Verdict:
    enabled: bool
    visible: bool
    text: str
    tooltip: str
    reason: ActionReason


class MissingVerdictError(KeyError):
    """`ActionId` 没有对应的判定函数；属于表没填完。"""


def host_config(state: AppState) -> HostConfig | None:
    """当前目标的 `info` 快照；未返回或读取失败时为 None。"""
    return state.hosts.get(state.target.key)


def data_ready(state: AppState) -> bool:
    """数据目录已初始化；已登录也视为就绪（登录前提就是有库）。"""
    if state.identity is not None:
        return True
    host = host_config(state)
    return bool(host is not None and host.initialized)


def is_busy(state: AppState) -> bool:
    """有任意在途任务；串行 lane 保证同时最多一个。"""
    return bool(state.inflight)


def _systemd_active(host: HostConfig | None) -> bool:
    return bool(host is not None and host.service.installed and host.service.active)


def service_active(host: HostConfig | None) -> bool:
    """systemd 服务是否在运行。

    服务页只把这个事实交给安装表单（决定“更新后重启”文案），不在页面里
    直接读 ``host.service.active``；状态判定仍以这里为准。
    """
    return bool(host is not None and host.service.active)


def is_running(state: AppState) -> bool:
    """前台会话或已运行的 systemd 服务都算运行中。"""
    return state.foreground is not None or _systemd_active(host_config(state))


def _stopping(state: AppState) -> bool:
    foreground = state.foreground
    return bool(
        foreground is not None and foreground.phase is ForegroundPhase.STOPPING
    )


class ServiceMode(StrEnum):
    UNKNOWN = "unknown"
    SYSTEMD = "systemd"
    FOREGROUND = "foreground"
    UNSUPPORTED = "unsupported"


def service_mode(state: AppState) -> ServiceMode:
    host = host_config(state)
    if host is None:
        return ServiceMode.UNKNOWN
    if host.service.installed:
        return ServiceMode.SYSTEMD
    if host.service.supported:
        return ServiceMode.FOREGROUND
    return ServiceMode.UNSUPPORTED


def page_url(state: AppState) -> str:
    """本机：前台 URL > Public URL > listen 推导；远端只认 Public URL。"""
    host = host_config(state)
    foreground = state.foreground
    if foreground is not None and foreground.url and not state.target.remote:
        return foreground.url.rstrip("/")
    if host is not None and host.public_url:
        return host.public_url.rstrip("/")
    if state.target.remote:
        # 远端监听在远端；GUI 不做端口映射，没有 Public URL 就没有可打开地址。
        return ""
    if host is None:
        return ""
    listen = (host.listen or server_config.DEFAULT_LISTEN).strip()
    listen = listen.replace("[::]", "127.0.0.1").replace("0.0.0.0", "127.0.0.1")
    if listen.startswith(":"):
        listen = "127.0.0.1" + listen
    if listen.isdigit():
        listen = "127.0.0.1:" + listen
    return "http://" + listen


def _backup_denial(state: AppState) -> tuple[ActionReason, str] | None:
    if not data_ready(state):
        return ActionReason.NOT_INITIALIZED, "数据目录还没有初始化"
    identity = state.identity
    if identity is not None and not identity.is_owner:
        return ActionReason.FORBIDDEN, "需要 Owner 权限"
    return None


def backup_reason(state: AppState) -> str:
    """备份/记录/恢复唯一的置灰理由；空串表示可以点。"""
    denial = _backup_denial(state)
    return "" if denial is None else denial[1]


def remaining_seconds(identity: parsing.Identity, now: datetime) -> int:
    """登录剩余秒数；过期返回 0。"""
    return max(0, int((identity.expires_at - now).total_seconds()))


def remaining_text(identity: parsing.Identity, now: datetime) -> str:
    seconds = remaining_seconds(identity, now)
    if seconds <= 0:
        return "已过期"
    minutes = (seconds + 59) // 60
    return f"{minutes} 分钟后过期"


def _gate(state: AppState) -> ActionReason | None:
    if state.closing or state.phase is Phase.CLOSING:
        return ActionReason.CLOSING
    if is_busy(state):
        return ActionReason.BUSY
    return None


def _verdict(
    state: AppState,
    text: str,
    *,
    visible: bool = True,
    reason: ActionReason = ActionReason.OK,
    tooltip: str | None = None,
) -> Verdict:
    """统一应用“关闭/忙碌”闸门，并补默认 tooltip。"""
    blocked = _gate(state)
    if blocked is not None:
        return Verdict(False, visible, text, _REASON_TEXT[blocked], blocked)
    tip = _REASON_TEXT[reason] if tooltip is None and reason is not ActionReason.OK else (
        tooltip or ""
    )
    return Verdict(reason is ActionReason.OK, visible, text, tip, reason)


def _selected_user(state: AppState) -> parsing.User | None:
    if state.selected is None:
        return None
    return next(
        (user for user in state.users if user.username == state.selected), None
    )


def _selection_verdict(
    state: AppState,
    text: str,
    allowed: Callable[[parsing.Identity, parsing.User], bool],
    *,
    self_tip: str = "",
    forbidden_tip: str = "只能操作权限低于自己的账户",
) -> Verdict:
    identity = state.identity
    if identity is None:
        return _verdict(state, text, reason=ActionReason.NOT_LOGGED_IN)
    user = _selected_user(state)
    if user is None:
        return _verdict(state, text, reason=ActionReason.NO_SELECTION, tooltip="")
    if allowed(identity, user):
        return _verdict(state, text)
    if self_tip and user.username == identity.username:
        return _verdict(state, text, reason=ActionReason.FORBIDDEN, tooltip=self_tip)
    return _verdict(
        state, text, reason=ActionReason.FORBIDDEN, tooltip=forbidden_tip
    )


def _account_read_verdict(state: AppState, text: str) -> Verdict:
    """刷新/添加：未登录时允许点击以弹出登录框，User 身份则无权限。"""
    if not data_ready(state):
        return _verdict(
            state,
            text,
            reason=ActionReason.NOT_INITIALIZED,
            tooltip="先初始化数据目录",
        )
    identity = state.identity
    if identity is not None and not identity.is_admin:
        return _verdict(
            state,
            text,
            reason=ActionReason.FORBIDDEN,
            tooltip="需要 Admin 或 Owner 权限",
        )
    tip = "登录后管理账户" if identity is None else ""
    return _verdict(state, text, tooltip=tip)


def _backup_verdict(state: AppState, text: str, *, visible: bool = True) -> Verdict:
    denial = _backup_denial(state)
    if denial is not None:
        return _verdict(
            state, text, visible=visible, reason=denial[0], tooltip=denial[1]
        )
    tip = "登录后可以创建备份" if state.identity is None else ""
    return _verdict(state, text, visible=visible, tooltip=tip)


# ---- 表驱动判定 -------------------------------------------------------


def _start(state: AppState, now: datetime) -> Verdict:
    text = "启动"
    foreground = state.foreground
    if foreground is not None:
        if foreground.phase is ForegroundPhase.STOPPING:
            return _verdict(
                state, text, reason=ActionReason.STOPPING, tooltip="正在停止服务"
            )
        return _verdict(state, text, reason=ActionReason.ALREADY_RUNNING)
    host = host_config(state)
    if _systemd_active(host):
        return _verdict(state, text, reason=ActionReason.ALREADY_RUNNING)
    tooltip = (
        "通过 systemd 用户服务启动"
        if host is not None and host.service.installed
        else "以前台进程启动，关闭窗口会停止"
    )
    return _verdict(state, text, tooltip=tooltip)


def _stop(state: AppState, now: datetime) -> Verdict:
    text = "停止"
    if _stopping(state):
        return _verdict(
            state, text, reason=ActionReason.STOPPING, tooltip="正在停止服务"
        )
    if state.foreground is not None:
        return _verdict(state, text, tooltip="停止前台会话")
    if _systemd_active(host_config(state)):
        return _verdict(state, text, tooltip="停止 systemd 用户服务")
    return _verdict(state, text, reason=ActionReason.NOT_RUNNING)


def _restart(state: AppState, now: datetime) -> Verdict:
    text = "重启"
    host = host_config(state)
    visible = bool(
        host is not None and host.service.supported and host.service.installed
    )
    if not visible:
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.NOT_INSTALLED,
            tooltip="先安装 systemd 服务",
        )
    if _stopping(state):
        return _verdict(
            state, text, reason=ActionReason.STOPPING, tooltip="正在停止服务"
        )
    if not is_running(state):
        return _verdict(
            state,
            text,
            reason=ActionReason.NOT_RUNNING,
            tooltip="服务没有在运行，先用“启动服务”",
        )
    return _verdict(state, text, tooltip="重启 systemd 用户服务")


def _open_page(state: AppState, now: datetime) -> Verdict:
    text = "打开页面"
    url = page_url(state)
    remote = state.target.remote
    # 远端没有 Public URL 时不展示入口；info 还没回来时先按“不可用”保留按钮。
    if remote and host_config(state) is not None and not url:
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.NO_URL,
            tooltip="远端服务需要先配置 Public URL，GUI 不做端口映射",
        )
    if _stopping(state):
        return _verdict(
            state, text, reason=ActionReason.STOPPING, tooltip="正在停止服务"
        )
    if not is_running(state):
        return _verdict(state, text, reason=ActionReason.NOT_RUNNING)
    if not url:
        return _verdict(state, text, reason=ActionReason.NO_URL)
    return _verdict(state, text, tooltip=url)


def _install(state: AppState, now: datetime) -> Verdict:
    text = "安装服务"
    host = host_config(state)
    visible = bool(
        host is not None and host.service.supported and not host.service.installed
    )
    if not visible:
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.UNSUPPORTED,
            tooltip="当前平台不支持 systemd 服务",
        )
    if not data_ready(state):
        return _verdict(
            state,
            text,
            reason=ActionReason.NOT_INITIALIZED,
            tooltip="先初始化数据目录",
        )
    return _verdict(
        state, text, tooltip="安装 systemd 服务；系统级会给出命令供复制"
    )


def _update(state: AppState, now: datetime) -> Verdict:
    text = "更新服务"
    host = host_config(state)
    visible = bool(
        host is not None and host.service.supported and host.service.installed
    )
    if not visible:
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.NOT_INSTALLED,
            tooltip="先安装 systemd 服务",
        )
    if not data_ready(state):
        return _verdict(
            state,
            text,
            reason=ActionReason.NOT_INITIALIZED,
            tooltip="先初始化数据目录",
        )
    return _verdict(
        state, text, tooltip="按当前二进制和数据目录重写 systemd 用户 unit"
    )


def _uninstall(state: AppState, now: datetime) -> Verdict:
    text = "卸载服务"
    host = host_config(state)
    visible = bool(
        host is not None and host.service.supported and host.service.installed
    )
    if not visible:
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.NOT_INSTALLED,
            tooltip="先安装 systemd 服务",
        )
    return _verdict(
        state, text, tooltip="停止并删除 systemd 用户 unit，不删除数据"
    )


def _refresh_users(state: AppState, now: datetime) -> Verdict:
    return _account_read_verdict(state, "刷新")


def _add_user(state: AppState, now: datetime) -> Verdict:
    return _account_read_verdict(state, "添加")


def _reset_password(state: AppState, now: datetime) -> Verdict:
    return _selection_verdict(
        state,
        "重置密码",
        lambda identity, user: identity.can_reset_password(user),
    )


def _toggle_user(state: AppState, now: datetime) -> Verdict:
    user = _selected_user(state)
    text = "启用" if user is not None and user.disabled else "禁用"
    return _selection_verdict(
        state,
        text,
        lambda identity, target: (
            identity.can_operate(target)
            if target.disabled
            else identity.can_disable(target)
        ),
        self_tip="不能操作自己",
    )


def _grant_revoke(state: AppState, text: str) -> Verdict:
    identity = state.identity
    if identity is None:
        return _verdict(state, text, reason=ActionReason.NOT_LOGGED_IN)
    if not identity.is_owner:
        return _verdict(
            state,
            text,
            reason=ActionReason.FORBIDDEN,
            tooltip="需要 Owner 权限",
        )
    if _selected_user(state) is None:
        return _verdict(state, text, reason=ActionReason.NO_SELECTION, tooltip="")
    return _verdict(state, text)


def _grant(state: AppState, now: datetime) -> Verdict:
    return _grant_revoke(state, "授予组")


def _revoke(state: AppState, now: datetime) -> Verdict:
    return _grant_revoke(state, "撤销组")


def _delete_user(state: AppState, now: datetime) -> Verdict:
    return _selection_verdict(
        state,
        "删除",
        lambda identity, user: identity.can_delete(user),
        self_tip="不能删除自己",
    )


def _backup_now(state: AppState, now: datetime) -> Verdict:
    return _backup_verdict(state, "立即备份")


def _backup_as(state: AppState, now: datetime) -> Verdict:
    text = "备份到…"
    if not state.target.supports(Capability.SAVE_BACKUP_AS):
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.REMOTE_UNSUPPORTED,
            tooltip="远端备份写到远端配置的备份地址，请用“立即备份”",
        )
    return _backup_verdict(state, text)


def _manage_backups(state: AppState, now: datetime) -> Verdict:
    return _backup_verdict(state, "备份记录…")


def _restore(state: AppState, now: datetime) -> Verdict:
    denial = _backup_denial(state)
    if denial is not None:
        return _verdict(
            state, "恢复所选", reason=denial[0], tooltip=denial[1]
        )
    if state.selected_backup is None:
        return _verdict(
            state,
            "恢复所选",
            reason=ActionReason.NO_BACKUP_SELECTED,
        )
    return _verdict(state, "恢复所选")


def _login(state: AppState, now: datetime) -> Verdict:
    text = "登录"
    if state.identity is not None:
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.ALREADY_LOGGED_IN,
        )
    if not data_ready(state):
        return _verdict(
            state,
            text,
            reason=ActionReason.NOT_INITIALIZED,
            tooltip="先创建 Owner",
        )
    return _verdict(state, text)


def _logout(state: AppState, now: datetime) -> Verdict:
    text = "退出登录"
    if state.identity is None:
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.NOT_LOGGED_IN,
        )
    return _verdict(state, text)


def _setup_owner(state: AppState, now: datetime) -> Verdict:
    text = "创建 Owner"
    if data_ready(state):
        return _verdict(
            state,
            text,
            visible=False,
            reason=ActionReason.ALREADY_INITIALIZED,
        )
    return _verdict(state, text)


def _settings_save_connection(state: AppState, now: datetime) -> Verdict:
    return _verdict(
        state, "保存连接", tooltip="只保存 config.gui.json，不切换当前目标"
    )


def _settings_apply_target(state: AppState, now: datetime) -> Verdict:
    return _verdict(state, "应用切换", tooltip="保存连接并切换到新目标")


def _settings_save_server(state: AppState, now: datetime) -> Verdict:
    text = "保存配置"
    if host_config(state) is None:
        return _verdict(
            state,
            text,
            reason=ActionReason.INFO_PENDING,
            tooltip="正在读取目标主机配置…",
        )
    return _verdict(
        state, text, tooltip="逐项写入目标主机 config.json，并重读 info"
    )


def _test_connection(state: AppState, now: datetime) -> Verdict:
    return _verdict(state, "测试连接", tooltip="用 info 测试 SSH 连接与二进制路径")


def _help(state: AppState, now: datetime) -> Verdict:
    return _verdict(state, "命令行帮助")


_VERDICTS: dict[ActionId, Callable[[AppState, datetime], Verdict]] = {
    ActionId.START: _start,
    ActionId.STOP: _stop,
    ActionId.RESTART: _restart,
    ActionId.OPEN_PAGE: _open_page,
    ActionId.INSTALL: _install,
    ActionId.UPDATE: _update,
    ActionId.UNINSTALL: _uninstall,
    ActionId.REFRESH_USERS: _refresh_users,
    ActionId.ADD_USER: _add_user,
    ActionId.RESET_PASSWORD: _reset_password,
    ActionId.TOGGLE_USER: _toggle_user,
    ActionId.GRANT: _grant,
    ActionId.REVOKE: _revoke,
    ActionId.DELETE_USER: _delete_user,
    ActionId.BACKUP_NOW: _backup_now,
    ActionId.BACKUP_AS: _backup_as,
    ActionId.MANAGE_BACKUPS: _manage_backups,
    ActionId.RESTORE: _restore,
    ActionId.LOGIN: _login,
    ActionId.LOGOUT: _logout,
    ActionId.SETTINGS_SAVE_CONNECTION: _settings_save_connection,
    ActionId.SETTINGS_APPLY_TARGET: _settings_apply_target,
    ActionId.SETTINGS_SAVE_SERVER: _settings_save_server,
    ActionId.TEST_CONNECTION: _test_connection,
    ActionId.HELP: _help,
    ActionId.SETUP_OWNER: _setup_owner,
}


def _coerce_action(action: ActionId | str) -> ActionId:
    if isinstance(action, ActionId):
        return action
    try:
        return ActionId(action)
    except (ValueError, TypeError):
        try:
            return ActionId[str(action)]
        except KeyError as exc:
            raise MissingVerdictError(f"未知动作：{action!r}") from exc


def action_verdict(
    state: AppState, action: ActionId | str, now: datetime
) -> Verdict:
    """对任意 `ActionId` 返回 Verdict；表里缺项直接抛错。"""
    key = _coerce_action(action)
    handler = _VERDICTS.get(key)
    if handler is None:
        raise MissingVerdictError(f"缺少动作判定：{key.value}")
    return handler(state, now)
