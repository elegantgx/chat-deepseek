"""服务页：状态卡、运行详情与前台日志。

页面只读 ``controller.state`` 和 ``render.UiState``：按钮的可见/可用/文案
全部来自 ``ui.buttons[ActionId]``，页面自己只负责把事实填进控件、拼安装
参数和处理一次性的“启动后打开页面”。
"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices, QGuiApplication
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMenu,
    QPlainTextEdit,
    QWidget,
)

import service_plan

from ...domain import rules
from ...domain.rules import ActionId
from .. import forms, primitives, render, tokens
from ..dialogs import ServiceInstallSheet, ask_confirm
from ..primitives.field import _ElidedLabel
from .base import Page, PageId

if TYPE_CHECKING:
    from ...domain.state import AppState
    from ..render import UiState

#: 日志只保留最近这么多行；与 ``ForegroundSession.tail`` 的上限一致。
LOG_LINES = 40

#: 安装/卸载确认文案；数据目录永远不动。
UNINSTALL_TITLE = "卸载服务"
UNINSTALL_MESSAGE = "停止并删除 systemd 服务？数据目录不会改动。"


class ServicePage(Page):
    """服务页；保留 ``ServicePage(controller)`` 构造。"""

    def __init__(self, controller) -> None:
        super().__init__(
            controller,
            page_id=PageId.SERVICE,
            title="服务",
            description="服务状态、运行方式与日志。",
        )
        self._remove_placeholder()

        self._page_url = ""
        self._auto_opened_url: str | None = None
        self._primary_setup = False
        self._info_error = False
        self._buttons = {}

        self._build()
        self._connect()

    # -- 装配 --------------------------------------------------------------

    def _remove_placeholder(self) -> None:
        """删掉 base 的占位说明，内容直接进 ``self.body``。"""
        self.placeholder.hide()
        self.body.removeWidget(self.placeholder)
        self.placeholder.setParent(None)
        self.placeholder.deleteLater()

    def _add_body(self, widget: QWidget, stretch: int = 0) -> None:
        """插到 base 末尾的弹簧之前，保证内容顶对齐。"""
        self.body.insertWidget(self.body.count() - 1, widget, stretch)

    def _build(self) -> None:
        self._build_status_card()
        self._build_banner()
        self._build_detail_card()
        self._build_log_card()

    def _build_status_card(self) -> None:
        self.status_card = primitives.Surface(kind="card", parent=self.widget)
        self._add_body(self.status_card)

        header = primitives.SectionHeading("服务", self.status_card)
        self.detail_label = _ElidedLabel("", 12, 400, "muted", self.status_card)
        self.status_badge = primitives.Badge(
            "尚未启动", "muted", kind="soft", dot=True, parent=self.status_card
        )
        header.add(self.detail_label, 1)
        header.add(self.status_badge)
        self.status_card.body.addWidget(header)

        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))
        self.primary_button = primitives.Button(
            "启动服务", kind="primary", size="lg", parent=self.status_card
        )
        self.restart_button = primitives.Button(
            "重启", kind="secondary", size="lg", parent=self.status_card
        )
        self.open_button = primitives.Button(
            "打开页面", kind="secondary", size="lg", parent=self.status_card
        )
        self.more_button = primitives.Button(
            "⋯", kind="secondary", size="lg", parent=self.status_card
        )
        self.more_button.setAccessibleName("更多服务操作")
        self.auto_open = primitives.SwitchRow(
            "启动后打开页面", True, self.status_card
        )
        row.addWidget(self.primary_button, 0)
        row.addWidget(self.restart_button, 0)
        row.addWidget(self.open_button, 0)
        row.addWidget(self.more_button, 0)
        row.addStretch(1)
        row.addWidget(self.auto_open, 0, Qt.AlignmentFlag.AlignVCenter)
        self.status_card.body.addLayout(row)

        self.menu = QMenu(self.more_button)
        self.install_action = self.menu.addAction("安装服务")
        self.update_action = self.menu.addAction("更新服务")
        self.uninstall_action = self.menu.addAction("卸载服务")
        self.menu.addSeparator()
        self.help_action = self.menu.addAction("命令行帮助")
        self.more_button.setMenu(self.menu)

    def _build_banner(self) -> None:
        self.banner = primitives.Surface(kind="panel", parent=self.widget)
        self.banner_label = QLabel("", self.banner)
        self.banner_label.setFont(tokens.font(12))
        self.banner_label.setProperty("tone", "warning")
        self.banner_label.setWordWrap(True)
        self.banner.body.addWidget(self.banner_label)
        self.banner.setVisible(False)
        self._add_body(self.banner)

    def _build_detail_card(self) -> None:
        self.detail_card = primitives.Surface(kind="card", parent=self.widget)
        self._add_body(self.detail_card)
        self.detail_card.body.addWidget(
            primitives.SectionHeading("运行详情", self.detail_card)
        )

        self.data_dir_row = forms.CopyRow("数据目录", "—", parent=self.detail_card)
        self.unit_row = forms.CopyRow("安装位置", "—", parent=self.detail_card)
        self.linger_row = forms.CopyRow("linger 命令", "", parent=self.detail_card)
        self.detail_card.body.addWidget(self.data_dir_row)
        self.detail_card.body.addWidget(self.unit_row)
        self.detail_card.body.addWidget(self.linger_row)

        badges = QHBoxLayout()
        badges.setContentsMargins(0, 0, 0, 0)
        badges.setSpacing(tokens.space(8))
        self.autostart_badge = primitives.Badge(
            "未开机自启", "muted", dot=False, parent=self.detail_card
        )
        self.linger_badge = primitives.Badge(
            "linger 未开启", "warning", dot=False, parent=self.detail_card
        )
        badges.addWidget(self.autostart_badge)
        badges.addWidget(self.linger_badge)
        badges.addStretch(1)
        self.systemd_link = primitives.Button(
            "改为 systemd 常驻…", kind="ghost", size="md", parent=self.detail_card
        )
        badges.addWidget(self.systemd_link, 0, Qt.AlignmentFlag.AlignVCenter)
        self.detail_card.body.addLayout(badges)

    def _build_log_card(self) -> None:
        self.log_card = primitives.Surface(kind="card", parent=self.widget)
        self._add_body(self.log_card)
        header = primitives.SectionHeading("运行日志", self.log_card)
        self.log_copy = primitives.Button(
            "复制", kind="secondary", size="lg", parent=self.log_card
        )
        self.log_copy.setAccessibleName("复制运行日志")
        header.add(self.log_copy)
        self.log_card.body.addWidget(header)

        self.log_view = QPlainTextEdit(self.log_card)
        self.log_view.setReadOnly(True)
        self.log_view.setUndoRedoEnabled(False)
        self.log_view.setMaximumBlockCount(LOG_LINES)
        self.log_view.setFont(tokens.font(11))
        self.log_view.setMinimumHeight(tokens.height(60))
        self.log_view.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.log_card.body.addWidget(self.log_view, 1)
        self.log_card.setVisible(False)

    def _connect(self) -> None:
        self.primary_button.clicked.connect(self._on_primary)
        self.restart_button.clicked.connect(self.controller.restart_service)
        self.open_button.clicked.connect(self._open_page)
        self.install_action.triggered.connect(self._open_install_sheet)
        self.update_action.triggered.connect(self._open_install_sheet)
        self.uninstall_action.triggered.connect(self._uninstall)
        self.help_action.triggered.connect(self.controller.show_help)
        self.systemd_link.clicked.connect(self._open_install_sheet)
        self.log_copy.clicked.connect(self._copy_log)

    # -- 动作 --------------------------------------------------------------

    def _on_primary(self) -> None:
        """主按钮：未初始化先创建 Owner；否则按运行态启动/停止。"""
        if self._primary_setup:
            self.controller.set_page(PageId.ACCOUNTS)
            return
        if rules.is_running(self.controller.state):
            self.controller.stop_service()
        else:
            self.controller.start_service()

    def _open_page(self) -> None:
        url = self._page_url
        if not url:
            return
        QDesktopServices.openUrl(QUrl(url))

    def _copy_log(self) -> None:
        clipboard = QGuiApplication.clipboard()
        if clipboard is not None:
            clipboard.setText(self.log_view.toPlainText())

    def _install_parent(self) -> QWidget | None:
        return self.widget

    def _open_install_sheet(self) -> None:
        state = self.controller.state
        host = rules.host_config(state)
        if host is None:
            return
        sheet = ServiceInstallSheet(
            self._install_parent(),
            binary=state.target.binary,
            data_dir=host.data_dir or state.target.data_dir,
            linger=host.service.linger,
            username=self.controller.service_user,
            host=state.target.host if state.target.remote else "",
            installed=host.service.installed,
            enabled=host.service.enabled,
            active=host.service.active,
        )
        value = sheet.exec_modal()
        if not isinstance(value, dict):
            return
        if host.service.installed:
            self.controller.update_service(value)
        else:
            self.controller.install_service(value)

    def _uninstall(self) -> None:
        if ask_confirm(
            self._install_parent(),
            UNINSTALL_TITLE,
            UNINSTALL_MESSAGE,
            danger=True,
        ):
            self.controller.uninstall_service()

    # -- 渲染 --------------------------------------------------------------

    def _apply_verdict(
        self, widget, action: ActionId, *, keep_text: bool = False
    ) -> None:
        """应用 Verdict；``info`` 读取失败时整体禁用操作（缺少刷新入口）。"""
        verdict = self._buttons.get(action)
        if verdict is None:
            return
        if keep_text:
            # 空文案让 apply_verdict 保留控件自己的文字（如“改为 systemd 常驻…”）。
            verdict = replace(verdict, text="")
        render.apply_verdict(widget, verdict)
        if self._info_error and verdict.enabled:
            widget.setEnabled(False)
            widget.setToolTip("状态读取失败，暂时不能操作")

    def _apply_action(self, action, action_id: ActionId) -> None:
        """QAction 没有 ``isHidden``；只同步可见/启用/提示，不改菜单文案。"""
        verdict = self._buttons.get(action_id)
        if verdict is None:
            return
        if action.isVisible() != verdict.visible:
            action.setVisible(verdict.visible)
        enabled = verdict.enabled
        if self._info_error and enabled:
            enabled = False
        action.setEnabled(enabled)
        action.setToolTip(
            "状态读取失败，暂时不能操作" if self._info_error else verdict.tooltip
        )

    def render(self, ui: "UiState", state: "AppState | None") -> None:
        if state is None:
            return
        self._buttons = dict(ui.buttons)
        self._info_error = bool(state.info_error)
        self._page_url = ui.page_url

        self._render_status(ui, state)
        self._render_banner(state)
        self._render_detail(state)
        self._render_log(state)
        self._maybe_auto_open(ui, state)

    def _render_status(self, ui: "UiState", state: "AppState") -> None:
        if self.detail_label.full_text() != ui.service_detail:
            self.detail_label.setText(ui.service_detail)
        self.status_badge.set_state(*ui.service_pill)

        host = rules.host_config(state)
        self._primary_setup = bool(host is not None and not host.initialized)
        if self._primary_setup:
            self._apply_verdict(self.primary_button, ActionId.SETUP_OWNER)
        elif rules.is_running(state):
            self._apply_verdict(self.primary_button, ActionId.STOP)
        else:
            self._apply_verdict(self.primary_button, ActionId.START)

        self._apply_verdict(self.restart_button, ActionId.RESTART)
        self._apply_verdict(self.open_button, ActionId.OPEN_PAGE)
        self._apply_action(self.install_action, ActionId.INSTALL)
        self._apply_action(self.update_action, ActionId.UPDATE)
        self._apply_action(self.uninstall_action, ActionId.UNINSTALL)
        self._apply_action(self.help_action, ActionId.HELP)

    def _render_banner(self, state: "AppState") -> None:
        host = rules.host_config(state)
        text = ""
        tone = "warning"
        if state.info_error:
            text = f"状态读取失败：{state.info_error}。GUI 暂未提供刷新入口，请检查连接后重试。"
            tone = "danger"
        elif host is not None and not host.initialized:
            text = "数据目录未初始化：先创建 Owner，服务才能启动。"
        if self.banner_label.text() != text:
            self.banner_label.setText(text)
        if text:
            if self.banner_label.property("tone") != tone:
                self.banner_label.setProperty("tone", tone)
                self._repolish(self.banner_label)
            self.banner.setVisible(True)
        else:
            self.banner.setVisible(False)

    def _render_detail(self, state: "AppState") -> None:
        host = rules.host_config(state)
        self.detail_card.setVisible(host is not None)
        if host is None:
            return

        data_dir = host.data_dir or state.target.data_dir or "—"
        self._set_copy(self.data_dir_row, data_dir)
        self._set_copy(self.unit_row, host.service.unit or "—")

        linger_command = service_plan.linger_command(
            self.controller.service_user or "<user>",
            enable=not host.service.linger,
            host=state.target.host if state.target.remote else "",
        )
        self._set_copy(self.linger_row, linger_command)

        self._set_badge(
            self.autostart_badge,
            "开机自启" if host.service.enabled else "未开机自启",
            "success" if host.service.enabled else "muted",
        )
        self._set_badge(
            self.linger_badge,
            "linger 已开启" if host.service.linger else "linger 未开启",
            "success" if host.service.linger else "warning",
        )

        # 链接文案由页面定；可见/可用仍来自 INSTALL 的 Verdict。
        self._apply_verdict(
            self.systemd_link, ActionId.INSTALL, keep_text=True
        )

    def _render_log(self, state: "AppState") -> None:
        foreground = state.foreground
        self.log_card.setVisible(foreground is not None)
        if foreground is None:
            return
        text = "\n".join(foreground.tail[-LOG_LINES:])
        if self.log_view.toPlainText() != text:
            self.log_view.setPlainText(text)

    def _maybe_auto_open(self, ui: "UiState", state: "AppState") -> None:
        """有可打开地址、正在运行且开关勾选时只自动开一次。"""
        url = ui.page_url
        if not url or not rules.is_running(state):
            self._auto_opened_url = None
            return
        if self._auto_opened_url == url:
            return
        if not self.auto_open.isChecked():
            return
        self._auto_opened_url = url
        QDesktopServices.openUrl(QUrl(url))

    # -- 小工具 ------------------------------------------------------------

    def _set_copy(self, row: forms.CopyRow, value: str) -> None:
        if row.text() != value:
            row.setText(value)

    def _set_badge(self, badge: primitives.Badge, text: str, tone: str) -> None:
        if badge.text() != text or badge.tone() != tone:
            badge.set_state(text, tone)

    @staticmethod
    def _repolish(widget: QWidget) -> None:
        style = widget.style()
        style.unpolish(widget)
        style.polish(widget)
        widget.update()
