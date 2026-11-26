"""状态投影：AppState -> UiState，以及幂等的 apply。

页面/顶栏只读 ``UiState``，不自己判断权限、登录或服务状态：所有按钮的
visible/enabled/text/tooltip 都来自 ``rules.action_verdict``。``apply`` 只做
幂等的 setVisible / setEnabled / setText / setToolTip，并把当前页委托给
``Page.render(ui, state)``。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

import parsing

from ..domain import rules
from ..domain.facts import ForegroundPhase, HostConfig
from ..domain.rules import ActionId, Verdict
from ..domain.state import AppState, Notice, PageId
from ..domain.target import Target
from .views import Views

#: 备份摘要时间；与 BEHAVIOR_BASELINE §5 的文案保持一致。
_BACKUP_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


@dataclass(frozen=True)
class UiState:
    """一次渲染需要的全部投影值；纯数据，测试不需要建窗口。"""

    page: PageId
    buttons: Mapping[ActionId, Verdict]
    busy: bool
    target_label: str
    target_tooltip: str
    service_pill: tuple[str, str]
    service_detail: str
    identity_text: str
    identity_tooltip: str
    login_button_text: str
    version_label: str
    backup_line: str
    nav_badges: Mapping[PageId, str]
    page_url: str
    notice: Notice | None


def _short_path(path: str) -> str:
    """取路径最后一段做 chip 文案；根目录或空值原样保留。"""
    text = (path or "").strip().rstrip("/\\")
    if not text:
        return ""
    name = text.replace("\\", "/").rsplit("/", 1)[-1]
    return name or text


def _target_text(target: Target) -> tuple[str, str]:
    """返回 (chip 文案, tooltip)：本机 + 数据目录短名 / SSH 主机。"""
    short = _short_path(target.data_dir)
    if target.remote:
        base = f"SSH {target.host}".strip()
        label = f"{base} · {short}" if short else base
        tooltip = f"SSH {target.host}"
    else:
        label = f"本机 · {short}" if short else "本机"
        tooltip = "本机"
    lines = [tooltip, f"二进制：{target.binary}"]
    if target.data_dir:
        lines.append(f"数据目录：{target.data_dir}")
    return label, "\n".join(lines)


def _service_projection(
    state: AppState,
) -> tuple[tuple[str, str], str]:
    """服务胶囊 (text, tone) 与详情文字；只看 rules 的事实判断。"""
    foreground = state.foreground
    if foreground is not None:
        if foreground.phase is ForegroundPhase.STARTING:
            return ("启动中…", "warning"), "前台会话正在启动"
        if foreground.phase is ForegroundPhase.STOPPING:
            return ("正在停止…", "warning"), "正在停止前台会话"
        detail = foreground.address or foreground.url
        if detail and state.target.remote:
            detail = f"远端监听 {detail}（本机不可直连）"
        elif detail:
            detail = f"监听 {detail}"
        else:
            detail = "前台会话"
        return ("运行中", "success"), detail

    host: HostConfig | None = rules.host_config(state)
    if host is None:
        if state.info_error:
            return ("状态读取失败", "danger"), "状态读取失败 · 重试"
        return ("尚未启动", "muted"), "正在读取服务状态…"
    if not host.initialized:
        return ("未初始化", "warning"), "数据目录未初始化"

    service = host.service
    if service.installed and service.active:
        pill, detail = ("运行中", "success"), "systemd 服务"
    elif service.installed:
        pill, detail = ("已停止", "muted"), "systemd 服务 · 已安装"
    elif service.supported:
        pill, detail = ("未运行", "muted"), "未安装 systemd 服务（前台运行）"
    else:
        pill, detail = (
            ("未运行", "muted"),
            "当前平台不支持 systemd 服务（前台运行）",
        )
    if state.info_error:
        detail = f"{detail} · 状态读取失败"
    return pill, detail


def _identity_projection(
    state: AppState, now: datetime
) -> tuple[str, str, str]:
    """返回 (身份文案, tooltip, 登录按钮文案)。"""
    identity = state.identity
    if identity is None:
        return "未登录", "登录后才能管理账户和备份", "登录"
    text = (
        f"{identity.username}（{identity.role}）"
        f" · {rules.remaining_text(identity, now)}"
    )
    tooltip = (
        f"账户：{identity.username}\n"
        f"组：{identity.groups_text}\n"
        f"过期：{identity.expires_at:%Y-%m-%d %H:%M:%S}"
    )
    return text, tooltip, "退出"


def _version_label(state: AppState) -> str:
    host = rules.host_config(state)
    if host is None:
        label = "chat-deepseek"
    else:
        label = f"{host.version} · {host.os}/{host.arch}"
    if state.target.remote:
        label = f"{label} · SSH {state.target.host}"
    return label


def _latest_backup(backups: tuple[parsing.Backup, ...]) -> parsing.Backup | None:
    if not backups:
        return None
    return max(backups, key=lambda item: item.time)


def _backup_line(state: AppState) -> str:
    identity = state.identity
    if identity is None:
        return "登录后查看备份记录"
    if not identity.can_manage_backups:
        return "需要 Owner 登录才能查看备份"
    latest = _latest_backup(state.backups)
    if latest is None:
        return "还没有备份记录"
    return (
        f"最近备份：{latest.time.strftime(_BACKUP_TIME_FORMAT)}"
        f"（{latest.size}）"
    )


def _nav_badges(state: AppState) -> dict[PageId, str]:
    if state.identity is None:
        return {
            PageId.ACCOUNTS: "—",
            PageId.BACKUPS: "—",
        }
    return {
        PageId.ACCOUNTS: str(len(state.users)),
        PageId.BACKUPS: str(len(state.backups)),
    }


def derive_ui(state: AppState, now: datetime) -> UiState:
    """把领域事实投影成纯 UI 值；不读环境、不建控件。"""
    target_label, target_tooltip = _target_text(state.target)
    service_pill, service_detail = _service_projection(state)
    identity_text, identity_tooltip, login_button_text = _identity_projection(
        state, now
    )
    return UiState(
        page=state.page,
        buttons={
            action: rules.action_verdict(state, action, now)
            for action in ActionId
        },
        busy=bool(state.inflight),
        target_label=target_label,
        target_tooltip=target_tooltip,
        service_pill=service_pill,
        service_detail=service_detail,
        identity_text=identity_text,
        identity_tooltip=identity_tooltip,
        login_button_text=login_button_text,
        version_label=_version_label(state),
        backup_line=_backup_line(state),
        nav_badges=_nav_badges(state),
        page_url=rules.page_url(state),
        notice=state.notice,
    )


def _set_text(widget, text: str) -> None:
    setter = getattr(widget, "setText", None)
    getter = getattr(widget, "text", None)
    if callable(setter) and callable(getter) and getter() != text:
        setter(text)


def _set_visible(widget, visible: bool) -> None:
    if widget.isHidden() == bool(visible):
        widget.setVisible(bool(visible))


def _set_enabled(widget, enabled: bool) -> None:
    if widget.isEnabled() != bool(enabled):
        widget.setEnabled(bool(enabled))


def _set_tooltip(widget, tooltip: str) -> None:
    if widget.toolTip() != tooltip:
        widget.setToolTip(tooltip)


def apply_verdict(widget, verdict: Verdict) -> None:
    """把 Verdict 幂等写入一个按钮/控件：visible/enabled/text(非空才写)/tooltip。

    页面（C5c/C5d）用自己的按钮时直接调用这个 helper，不要再各写一份
    ``setVisible/setEnabled/setToolTip``；空文本保留控件原有文案。
    """
    _set_visible(widget, verdict.visible)
    _set_enabled(widget, verdict.enabled)
    if verdict.text:
        _set_text(widget, verdict.text)
    _set_tooltip(widget, verdict.tooltip)


def apply(ui: UiState, views: Views, state: AppState | None = None) -> None:
    """幂等应用 UiState。

    ``state`` 是可选的领域快照：当前页的 ``render(ui, state)`` 需要它，但纯
    UI 测试可以只验证投影。MainWindow 总是传入 ``controller.state``。
    """
    page = views.page(ui.page)
    if page is not None:
        views.stacked.setCurrentWidget(page.widget)
    for page_id, button in views.nav_buttons.items():
        button.set_selected(page_id == ui.page)
        button.set_badge(ui.nav_badges.get(page_id, ""))
        if page_id is PageId.SERVICE:
            button.set_dot(ui.service_pill[1])

    views.target_chip.set_target(
        ui.target_label,
        tooltip=ui.target_tooltip,
        compact=views.is_compact(),
    )
    views.service_chip.set_state(*ui.service_pill)
    _set_tooltip(views.service_chip, ui.service_detail)
    views.identity_chip.set_identity(
        ui.identity_text,
        tooltip=ui.identity_tooltip,
        username=state.identity.username if state and state.identity else "",
        logged_in=bool(state and state.identity),
        button_text=ui.login_button_text,
        button_tooltip="退出当前登录" if ui.login_button_text == "退出" else "登录 CLI 管理账户",
    )
    views.busy_spinner.set_busy(ui.busy)

    _set_text(views.status_version, ui.version_label)
    _set_text(views.status_backup, ui.backup_line)
    _set_tooltip(views.status_backup, ui.backup_line)
    help_verdict = ui.buttons.get(ActionId.HELP)
    if help_verdict is not None:
        apply_verdict(views.status_help, help_verdict)

    for action, widget in views.action_buttons.items():
        verdict = ui.buttons.get(action)
        if verdict is not None:
            apply_verdict(widget, verdict)

    if page is not None:
        page.render(ui, state)


__all__ = ["UiState", "apply", "apply_verdict", "derive_ui"]
