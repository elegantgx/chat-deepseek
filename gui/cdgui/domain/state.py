"""AppState：只存事实和交互。

这里**不**出现 `visible/enabled/loading/busy/pending/generation` 这类派生字段；
“能不能点”由 `rules.action_verdict` 现算，忙碌由 `inflight` 推导。reducer 是
纯函数，`assert_invariants` 在 Store 每次更新和测试前后调用。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping

import parsing

from .facts import ForegroundPhase, ForegroundSession, HostConfig
from .target import StrEnum, Target


class PageId(StrEnum):
    SERVICE = "service"
    ACCOUNTS = "accounts"
    BACKUPS = "backups"
    SETTINGS = "settings"


class Phase(StrEnum):
    BOOTING = "booting"
    READY = "ready"
    CLOSING = "closing"


class TaskKey(StrEnum):
    """串行 lane 上的任务标识；同一 key 同时最多一个 inflight。"""

    INFO = "info"
    IDENTITY = "identity"
    USERS = "users"
    BACKUPS = "backups"
    LOGIN = "login"
    LOGOUT = "logout"
    SETUP = "setup"
    SERVICE = "service"
    INSTALL = "install"
    UPDATE = "update"
    UNINSTALL = "uninstall"
    BACKUP = "backup"
    RESTORE = "restore"
    CONFIG = "config"
    USER_ACTION = "user_action"
    SERVE = "serve"
    HELP = "help"


class NoticeTone(StrEnum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


@dataclass(frozen=True)
class Notice:
    """一次性的用户提示；由 controller 在渲染后清掉。"""

    text: str
    tone: NoticeTone = NoticeTone.INFO
    details: str = ""


@dataclass(frozen=True)
class LoginPrompt:
    """登录 sheet 的交互事实：是否在提示、回填用户名、就地错误。"""

    username: str = ""
    error: str = ""


@dataclass(frozen=True)
class InflightEntry:
    """一个正在执行的任务；generation 由 runner 递增，迟到结果据此丢弃。"""

    task_key: TaskKey
    target_key: str
    generation: int


@dataclass(frozen=True)
class AppState:
    target: Target
    # 只缓存当前目标（key 必须等于 state.target.key）；切换目标会整块清空。
    hosts: Mapping[str, HostConfig] = field(default_factory=dict)
    identity: parsing.Identity | None = None
    users: tuple[parsing.User, ...] = ()
    backups: tuple[parsing.Backup, ...] = ()
    selected: str | None = None
    selected_backup: str | None = None
    foreground: ForegroundSession | None = None
    inflight: Mapping[TaskKey, InflightEntry] = field(default_factory=dict)
    login: LoginPrompt | None = None
    notice: Notice | None = None
    # 非空表示最近一次 info 读取失败；服务页据此常驻“状态读取失败 · 重试”。
    info_error: str | None = None
    page: PageId = PageId.SERVICE
    phase: Phase = Phase.BOOTING
    closing: bool = False

    def __post_init__(self) -> None:
        # 默认值共享可变对象的风险：这里只做浅拷贝，reducer 永远整块替换。
        if not isinstance(self.hosts, MappingProxyType):
            object.__setattr__(self, "hosts", MappingProxyType(dict(self.hosts)))
        if not isinstance(self.inflight, MappingProxyType):
            object.__setattr__(
                self, "inflight", MappingProxyType(dict(self.inflight))
            )


class InvariantError(AssertionError):
    """AppState 不满足领域不变量；属于编程错误，不是用户输入错误。"""


def assert_invariants(state: AppState) -> None:
    """检查全部可静态验证的不变量；失败抛 InvariantError。

    `identity` 与当前 target 的绑定靠构造维护：`target_changed` 会清空身份。
    `parsing.Identity` 没有 `target_key` 字段（稳定 CLI 契约），所以这里无法
    再交叉验证；其余事实都带 key。
    """
    target_key = state.target.key
    if not target_key:
        raise InvariantError("target.key 不能为空")

    for key, host in state.hosts.items():
        if key != host.target_key:
            raise InvariantError(
                f"hosts[{key!r}] 的 target_key 是 {host.target_key!r}"
            )
        if key != target_key:
            raise InvariantError(f"hosts 里残留了非当前目标的配置：{key}")
        if not host.data_dir:
            raise InvariantError("HostConfig.data_dir 不能为空")
        if state.target.data_dir and host.data_dir != state.target.data_dir:
            raise InvariantError(
                "HostConfig.data_dir 与 Target.data_dir 不一致"
            )
        service = host.service
        if service.active and not service.installed:
            raise InvariantError("HostConfig.service: active ⇒ installed 被破坏")
        if service.active and not service.supported:
            raise InvariantError("HostConfig.service: active 但平台不支持服务")

    if state.identity is None:
        if state.users:
            raise InvariantError("未登录时 users 必须为空")
        if state.backups:
            raise InvariantError("未登录时 backups 必须为空")
        if state.selected is not None:
            raise InvariantError("未登录时 selected 必须为空")
    else:
        names = [user.username for user in state.users]
        if len(names) != len(set(names)):
            raise InvariantError("users 里有重复用户名")
        if state.selected is not None and state.selected not in names:
            raise InvariantError(f"selected={state.selected!r} 不在 users 里")

    backup_names = {item.name for item in state.backups}
    if state.identity is None or not state.backups:
        if state.selected_backup is not None:
            raise InvariantError("无身份或 backups 为空时 selected_backup 必须为空")
    elif (
        state.selected_backup is not None
        and state.selected_backup not in backup_names
    ):
        raise InvariantError(
            f"selected_backup={state.selected_backup!r} 不在 backups 里"
        )

    foreground = state.foreground
    if foreground is not None:
        if foreground.target_key != target_key:
            raise InvariantError("foreground.target_key 与当前目标不一致")
        if len(foreground.tail) > 40:
            raise InvariantError("foreground.tail 超过 40 行")
        if not isinstance(foreground.phase, ForegroundPhase):
            try:
                ForegroundPhase(foreground.phase)
            except ValueError as exc:
                raise InvariantError(
                    f"未知的前台会话阶段：{foreground.phase!r}"
                ) from exc

    for key, entry in state.inflight.items():
        if key is not entry.task_key:
            raise InvariantError(f"inflight[{key!r}] 的 task_key 不一致")
        if entry.target_key != target_key:
            raise InvariantError("inflight 里有非当前目标的任务")
        if entry.generation < 1:
            raise InvariantError("inflight.generation 必须 ≥ 1")

    if state.closing and state.phase is not Phase.CLOSING:
        raise InvariantError("closing=True 时 phase 必须是 CLOSING")
    if state.phase is Phase.CLOSING and not state.closing:
        raise InvariantError("phase=CLOSING 时 closing 必须为 True")
