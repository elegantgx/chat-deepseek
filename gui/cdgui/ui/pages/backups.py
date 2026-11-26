"""备份页：备份地址、停机前置条件、记录列表与恢复。

页面只读 ``controller.state`` / ``UiState``；按钮的可见、可用和文案统一来自
``rules.action_verdict``。列表只在 ``state.backups`` 变化时重建，选中和滚动
位置跟着状态走；恢复与停止服务都各自做一次二次确认。
"""

from __future__ import annotations

import time
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from ...domain import rules
from ...domain.rules import ActionId
from ...domain.state import PageId
from .. import primitives, tokens
from ..dialogs import ask_confirm
from ..forms import CopyRow
from .base import Page

if TYPE_CHECKING:
    from ...domain.state import AppState
    from ..protocols import ControllerProtocol
    from ..render import UiState

#: 与状态栏、备份记录弹窗一致的时间格式。
BACKUP_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"

STOP_CONFIRM_TITLE = "停止服务"
STOP_CONFIRM_MESSAGE = "备份前需要先停止服务。停止后不会自动重启，确定吗？"
RESTORE_CONFIRM_TITLE = "恢复备份"
RESTORE_CONFIRM_MESSAGE = (
    "用备份 {name} 覆盖当前数据？\n\n"
    "会覆盖 chat.db、config.json、master.key 和 files/；"
    "请确认服务已经停止。"
)
LOGIN_TITLE = "Owner 登录后查看备份"
OWNER_REQUIRED_TITLE = "需要 Owner 登录"
OWNER_REQUIRED_HINT = "当前账户没有备份权限，请改用 Owner 登录。"
EMPTY_TITLE = "还没有备份"
EMPTY_HINT = "点上方“立即备份”创建第一个备份。"


def _set_text(widget, text: str) -> None:
    """幂等写文案，避免每秒渲染都触发布局。"""
    setter = getattr(widget, "setText", None)
    getter = getattr(widget, "text", None)
    if callable(setter) and callable(getter) and getter() != text:
        setter(text)


def _set_visible(widget: QWidget, visible: bool) -> None:
    if widget.isHidden() == bool(visible):
        widget.setVisible(bool(visible))


def _apply_verdict(widget: QWidget, verdict) -> None:
    # 延迟导入：render → views → pages 的导入链不能在页面模块顶层再回指 render。
    from ..render import apply_verdict

    apply_verdict(widget, verdict)


class BackupsPage(Page):
    """备份页。"""

    def __init__(self, controller: "ControllerProtocol") -> None:
        super().__init__(
            controller,
            page_id=PageId.BACKUPS,
            title="备份",
            description="",
        )
        self.rows: list[primitives.ListRow] = []
        self._backup_signature: tuple[tuple[str, str, datetime], ...] | None = None
        self._pending_scroll = 0
        self._strip_base_body()
        self._build()

    # -- 装配 --------------------------------------------------------------

    def _strip_base_body(self) -> None:
        """去掉骨架的占位说明和尾部 stretch；标题保留。"""
        self.body.removeWidget(self.placeholder)
        self.placeholder.deleteLater()
        while self.body.count():
            item = self.body.takeAt(0)
            widget = item.widget()
            if widget is not None and widget is not self.heading:
                widget.deleteLater()
        self.body.addWidget(self.heading)
        self.body.setSpacing(tokens.space(12))
        # 底栏贴底：底部只留一个最小间距。
        self.body.setContentsMargins(
            tokens.space(24),
            tokens.space(20),
            tokens.space(24),
            tokens.space(8),
        )

    def _build(self) -> None:
        self.lock_view = self._build_lock_view()
        self.content = self._build_content()
        self.body.addWidget(self.lock_view, 1)
        self.body.addWidget(self.content, 1)
        self.lock_view.setVisible(False)
        self.content.setVisible(False)

    def _build_lock_view(self) -> QWidget:
        view = QWidget(self.widget)
        column = QVBoxLayout(view)
        column.setContentsMargins(0, 0, 0, 0)
        column.setSpacing(tokens.space(12))
        column.addStretch(1)

        self.lock_glyph = primitives.LockGlyph("xxl", view)
        column.addWidget(
            self.lock_glyph, 0, Qt.AlignmentFlag.AlignHCenter
        )
        self.lock_title = QLabel("", view)
        self.lock_title.setObjectName("cdguiBackupsLockTitle")
        self.lock_title.setFont(tokens.font(15, 600))
        self.lock_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lock_title.setWordWrap(True)
        column.addWidget(self.lock_title)

        self.lock_hint = QLabel("", view)
        self.lock_hint.setObjectName("cdguiBackupsLockHint")
        self.lock_hint.setFont(tokens.font(12))
        self.lock_hint.setProperty("tone", "muted")
        self.lock_hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lock_hint.setWordWrap(True)
        column.addWidget(self.lock_hint)

        self.login_button = primitives.Button(
            "登录", kind="primary", size="lg", parent=view
        )
        self.login_button.setAccessibleName("登录 Owner 账户")
        self.login_button.clicked.connect(lambda: self.controller.ensure_login())
        column.addWidget(
            self.login_button, 0, Qt.AlignmentFlag.AlignHCenter
        )
        column.addStretch(1)
        return view

    def _build_content(self) -> QWidget:
        content = QWidget(self.widget)
        column = QVBoxLayout(content)
        column.setContentsMargins(0, 0, 0, 0)
        column.setSpacing(tokens.space(12))

        # 页头第一行：标题 + 三个动作挂在 base 的 SectionHeading 上。
        self.refresh_button = primitives.Button(
            "刷新", kind="secondary", size="lg", parent=content
        )
        self.refresh_button.setAccessibleName("刷新备份列表")
        self.refresh_button.clicked.connect(self.controller.refresh_backups)
        self.backup_as_button = primitives.Button(
            "备份到…", kind="secondary", size="lg", parent=content
        )
        self.backup_as_button.clicked.connect(self._choose_backup_path)
        self.backup_now_button = primitives.Button(
            "立即备份", kind="primary", size="lg", parent=content
        )
        self.backup_now_button.clicked.connect(self.controller.backup_now)
        self.heading.add(self.refresh_button)
        self.heading.add(self.backup_as_button)
        self.heading.add(self.backup_now_button)

        # 页头第二行：备份地址整行（标签 + 只读字段 + 复制），不再和按钮挤。
        self.address_row = CopyRow(
            "备份地址",
            "",
            hint="备份 ZIP 保存在目标主机的这个目录。",
            parent=content,
        )
        self.address_row.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred
        )
        column.addWidget(self.address_row)

        self.recent_label = QLabel("", content)
        self.recent_label.setObjectName("cdguiBackupsRecent")
        self.recent_label.setFont(tokens.font(12))
        self.recent_label.setProperty("tone", "muted")
        self.recent_label.setWordWrap(True)
        column.addWidget(self.recent_label)

        # 前置条件条紧接页头，然后才是列表；页面里不再有固定大空白。
        self.precondition = self._build_precondition(content)
        column.addWidget(self.precondition)

        self.info_error_panel = self._build_info_error(content)
        column.addWidget(self.info_error_panel)

        column.addWidget(self._build_list(content), 1)
        column.addWidget(self._build_footer(content))
        return content

    def _build_precondition(self, parent: QWidget) -> primitives.Surface:
        panel = primitives.Surface("panel", parent)
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))
        self.precondition_badge = primitives.Badge(
            "服务运行中", tone="warning", parent=panel
        )
        row.addWidget(self.precondition_badge, 0, Qt.AlignmentFlag.AlignVCenter)
        self.precondition_label = QLabel("备份需要先停止服务", panel)
        self.precondition_label.setFont(tokens.font(12, 500))
        row.addWidget(self.precondition_label, 1)
        self.stop_button = primitives.Button(
            "停止服务", kind="secondary", size="lg", parent=panel
        )
        self.stop_button.setAccessibleName("停止服务后备份")
        self.stop_button.clicked.connect(self._confirm_stop)
        row.addWidget(self.stop_button, 0, Qt.AlignmentFlag.AlignVCenter)
        panel.body.addLayout(row)
        panel.setVisible(False)
        return panel

    def _build_info_error(self, parent: QWidget) -> primitives.Surface:
        panel = primitives.Surface("panel", parent)
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))
        badge = primitives.Badge("状态读取失败", tone="danger", parent=panel)
        row.addWidget(badge, 0, Qt.AlignmentFlag.AlignVCenter)
        self.info_error_label = QLabel("", panel)
        self.info_error_label.setObjectName("cdguiBackupsInfoError")
        self.info_error_label.setFont(tokens.font(12))
        self.info_error_label.setProperty("tone", "danger")
        self.info_error_label.setWordWrap(True)
        row.addWidget(self.info_error_label, 1)
        panel.body.addLayout(row)
        panel.setVisible(False)
        return panel

    def _build_list(self, parent: QWidget) -> QScrollArea:
        self.list_scroll = QScrollArea(parent)
        self.list_scroll.setObjectName("cdguiBackupsScroll")
        self.list_scroll.setWidgetResizable(True)
        self.list_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.list_scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.list_scroll.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding
        )
        self.list_scroll.setMinimumHeight(tokens.height(60) * 3)

        host = QWidget(self.list_scroll)
        list_layout = QVBoxLayout(host)
        list_layout.setContentsMargins(0, 0, 0, 0)
        list_layout.setSpacing(0)
        self._rows_box = QVBoxLayout()
        self._rows_box.setContentsMargins(0, 0, 0, 0)
        self._rows_box.setSpacing(0)
        list_layout.addLayout(self._rows_box)

        self.empty_widget = QWidget(host)
        empty_layout = QVBoxLayout(self.empty_widget)
        empty_layout.setContentsMargins(0, 0, 0, 0)
        empty_layout.setSpacing(tokens.space(4))
        empty_layout.addStretch(1)
        self.empty_title = QLabel(EMPTY_TITLE, self.empty_widget)
        self.empty_title.setObjectName("cdguiBackupsEmptyTitle")
        self.empty_title.setFont(tokens.font(15, 600))
        self.empty_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_layout.addWidget(self.empty_title)
        self.empty_hint = QLabel(EMPTY_HINT, self.empty_widget)
        self.empty_hint.setObjectName("cdguiBackupsEmptyHint")
        self.empty_hint.setFont(tokens.font(12))
        self.empty_hint.setProperty("tone", "muted")
        self.empty_hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_hint.setWordWrap(True)
        empty_layout.addWidget(self.empty_hint)
        empty_layout.addStretch(1)
        list_layout.addWidget(self.empty_widget, 1)
        self._list_layout = list_layout

        self.list_scroll.setWidget(host)
        self._restore_timer = QTimer(self.list_scroll)
        self._restore_timer.setSingleShot(True)
        self._restore_timer.timeout.connect(self._restore_scroll)
        return self.list_scroll

    def _build_footer(self, parent: QWidget) -> primitives.Surface:
        footer = primitives.Surface("panel", parent)
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))
        self.selection_label = QLabel("未选择备份", footer)
        self.selection_label.setObjectName("cdguiBackupsSelection")
        self.selection_label.setFont(tokens.font(12, 500))
        self.selection_label.setProperty("tone", "muted")
        row.addWidget(self.selection_label, 0, Qt.AlignmentFlag.AlignVCenter)
        row.addStretch(1)
        self.restore_button = primitives.Button(
            "恢复所选", kind="danger", size="lg", parent=footer
        )
        self.restore_button.setAccessibleName("恢复选中的备份")
        self.restore_button.clicked.connect(self._restore_selected)
        row.addWidget(self.restore_button, 0, Qt.AlignmentFlag.AlignVCenter)
        footer.body.addLayout(row)
        return footer

    # -- 交互 --------------------------------------------------------------

    def _choose_backup_path(self) -> None:
        state = self.controller.state
        if state.target.remote:
            return
        host = rules.host_config(state)
        start = host.backup_dir if host is not None else ""
        if not start:
            start = str(Path.home())
        name = f"chat-deepseek-{time.strftime('%Y%m%d-%H%M%S')}.zip"
        path, _selected = QFileDialog.getSaveFileName(
            self.widget,
            "保存备份",
            str(Path(start) / name),
            "ZIP 备份 (*.zip)",
        )
        if path:
            self.controller.backup_as(path)

    def _confirm_stop(self) -> None:
        if not ask_confirm(
            self.widget,
            STOP_CONFIRM_TITLE,
            STOP_CONFIRM_MESSAGE,
            danger=True,
        ):
            return
        self.controller.stop_service()

    def _restore_selected(self) -> None:
        name = self.controller.state.selected_backup
        if not name:
            return
        if not ask_confirm(
            self.widget,
            RESTORE_CONFIRM_TITLE,
            RESTORE_CONFIRM_MESSAGE.format(name=name),
            danger=True,
        ):
            return
        self.controller.restore_backup(name)

    # -- 渲染 --------------------------------------------------------------

    def render(self, ui: "UiState", state: "AppState | None") -> None:
        if state is None:
            state = self.controller.state
        owner = ui.is_owner
        _set_visible(self.content, owner)
        _set_visible(self.lock_view, not owner)
        if not owner:
            self._render_lock(ui, state)
            return
        self._render_content(ui, state)

    def _render_lock(self, ui: "UiState", state: "AppState") -> None:
        identity = state.identity
        if identity is None:
            if rules.data_ready(state):
                title = LOGIN_TITLE
                hint = "登录 Owner 账户后可以查看、创建和恢复备份。"
            else:
                title = OWNER_REQUIRED_TITLE
                hint = "数据目录还没有初始化，先创建 Owner 再登录。"
        else:
            title = OWNER_REQUIRED_TITLE
            hint = f"{OWNER_REQUIRED_HINT}（当前账户：{identity.role}）"
        _set_text(self.lock_title, title)
        _set_text(self.lock_hint, hint)
        _apply_verdict(self.login_button, ui.buttons[ActionId.LOGIN])

    def _render_content(self, ui: "UiState", state: "AppState") -> None:
        host = rules.host_config(state)
        backup_dir = host.backup_dir if host is not None else ""
        _set_text(self.address_row, backup_dir)
        self.address_row.field.setToolTip(backup_dir)
        _set_text(self.recent_label, ui.backup_line)

        refresh = ui.buttons[ActionId.MANAGE_BACKUPS]
        _apply_verdict(self.refresh_button, replace(refresh, text="刷新"))
        _apply_verdict(self.backup_now_button, ui.buttons[ActionId.BACKUP_NOW])
        _apply_verdict(self.backup_as_button, ui.buttons[ActionId.BACKUP_AS])

        _set_visible(self.precondition, rules.is_running(state))
        if rules.is_running(state):
            stop = ui.buttons[ActionId.STOP]
            _apply_verdict(self.stop_button, replace(stop, text="停止服务"))

        _set_visible(self.info_error_panel, bool(state.info_error))
        if state.info_error:
            _set_text(
                self.info_error_label,
                f"状态读取失败：{state.info_error}。"
                "备份列表可能不是最新的，请检查连接后重试。",
            )

        self._sync_list(state)
        for row in self.rows:
            row.set_selected(row.key == state.selected_backup)

        if state.selected_backup:
            _set_text(self.selection_label, f"已选择 {state.selected_backup}")
        else:
            _set_text(self.selection_label, "未选择备份")
        _apply_verdict(self.restore_button, ui.buttons[ActionId.RESTORE])

    # -- 列表 --------------------------------------------------------------

    def _sync_list(self, state: "AppState") -> None:
        signature = tuple(
            (item.name, item.size, item.time) for item in state.backups
        )
        if signature == self._backup_signature:
            return
        self._backup_signature = signature
        self._pending_scroll = self.list_scroll.verticalScrollBar().value()

        for row in self.rows:
            self._rows_box.removeWidget(row)
            row.deleteLater()
        self.rows.clear()

        for archive in state.backups:
            self.rows.append(self._make_row(archive))
        self.empty_widget.setVisible(not state.backups)
        self._sync_tail_stretch(bool(state.backups))
        self._restore_timer.start(0)

    def _sync_tail_stretch(self, has_rows: bool) -> None:
        """记录列表末尾补一个弹簧让行从顶部排；空态块则自己占满视口。"""
        count = self._list_layout.count()
        has_spacer = (
            count > 0
            and self._list_layout.itemAt(count - 1).spacerItem() is not None
        )
        if has_rows and not has_spacer:
            self._list_layout.addStretch(1)
        elif not has_rows and has_spacer:
            self._list_layout.takeAt(count - 1)

    def _make_row(self, archive) -> primitives.ListRow:
        size = QLabel(archive.size, self.list_scroll)
        size.setFont(tokens.font(11, 500))
        size.setProperty("tone", "muted")
        size.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        row = primitives.ListRow(
            title=archive.time.strftime(BACKUP_TIME_FORMAT),
            subtitle=archive.name,
            trailing=size,
            key=archive.name,
            size="xxl",
            parent=self.list_scroll,
        )
        name = archive.name
        row.clicked.connect(lambda name=name: self.controller.select_backup(name))
        row.activated.connect(
            lambda name=name: self.controller.select_backup(name)
        )
        row.toggled.connect(
            lambda checked, name=name: self.controller.select_backup(
                name if checked else None
            )
        )
        row.upPressed.connect(lambda row=row: self._move_focus(row, -1))
        row.downPressed.connect(lambda row=row: self._move_focus(row, 1))
        self._rows_box.addWidget(row)
        return row

    def _move_focus(self, row: primitives.ListRow, delta: int) -> None:
        if row not in self.rows:
            return
        index = max(0, min(len(self.rows) - 1, self.rows.index(row) + delta))
        self.rows[index].setFocus()

    def _restore_scroll(self) -> None:
        bar = self.list_scroll.verticalScrollBar()
        bar.setValue(min(self._pending_scroll, bar.maximum()))
