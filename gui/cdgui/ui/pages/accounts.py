"""账户页：账户列表、选择与权限操作。

行对象的选中态、禁用样式和底栏动作都从 ``AppState`` / ``UiState`` 派生：
列表只在 ``state.users`` 变化时重建，选中与滚动位置单独更新；按钮是否可点
一律取 ``ui.buttons[ActionId]``。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

import parsing

from ...domain import rules
from ...domain.rules import ActionId
from .. import palette, primitives, render, tokens
from ..dialogs import AccountForm, GroupForm, PasswordForm, ask_confirm
from .base import Page, PageId

if TYPE_CHECKING:
    from ...domain.state import AppState
    from ..render import UiState

__all__ = ["AccountsPage", "UserRow"]

#: 组标签的固定顺序；未知组排在最后。
ROLE_ORDER = {"Owner": 0, "Admin": 1, "User": 2}

#: 空态与动作条文案。
EMPTY_LOADING_TITLE = "正在读取账户状态…"
EMPTY_NO_ACCOUNT_TITLE = "还没有账户"
EMPTY_NO_ACCOUNT_TEXT = "创建第一个 Owner，就能在浏览器里登录。"
EMPTY_LOGIN_TITLE = "登录后管理账户"
EMPTY_LOGIN_TEXT = "登录后可以查看账户、重置密码和调整组。"
EMPTY_ADD_TEXT = "点“+ 添加”创建第一个账户。"

DELETE_TITLE = "删除账户"
DELETE_MESSAGE = "永久删除账户 {username}？此操作不可撤销。"


class UserRow(primitives.ListRow):
    """60px 账户行：头像、用户名、组标签、右侧状态。"""

    ROLE_ORDER = ROLE_ORDER

    def __init__(self, user: parsing.User, parent: QWidget | None = None) -> None:
        self.user = user
        self.disabled = bool(user.disabled)
        avatar = primitives.Avatar(
            user.username, disabled=user.disabled, size="lg"
        )
        status = primitives.Badge(
            user.status_text,
            "danger" if user.disabled else "success",
            dot=True,
            parent=None,
        )
        super().__init__(
            title=user.username,
            subtitle="",
            avatar=avatar,
            trailing=status,
            key=user.username,
            size="xxl",
            parent=parent,
        )
        self.status_badge = status
        self.avatar = avatar
        self.group_badges: list[primitives.Badge] = []

        self.title.setProperty("tone", "muted" if user.disabled else "text")
        self._repolish(self.title)

        self.chips = QWidget(self)
        self.chips.setAttribute(
            Qt.WidgetAttribute.WA_TransparentForMouseEvents, True
        )
        chips_row = QHBoxLayout(self.chips)
        chips_row.setContentsMargins(0, 0, 0, 0)
        chips_row.setSpacing(tokens.space(4))
        for group in sorted(
            user.groups, key=lambda name: ROLE_ORDER.get(name, 9)
        ):
            badge = primitives.Badge(
                group,
                palette.group_tone(group),
                kind="soft",
                dot=False,
                parent=self.chips,
            )
            chips_row.addWidget(badge, 0, Qt.AlignmentFlag.AlignVCenter)
            self.group_badges.append(badge)
        chips_row.addStretch(1)
        self.chips.setFixedHeight(primitives.Badge.HEIGHT)
        self.subtitle.setVisible(False)
        self.column.insertWidget(1, self.chips)

        self.setAccessibleName(
            f"{user.username}，{user.groups_text or '无组'}，{user.status_text}"
        )

    @staticmethod
    def _repolish(widget: QWidget) -> None:
        style = widget.style()
        style.unpolish(widget)
        style.polish(widget)
        widget.update()


class AccountsPage(Page):
    """账户页；保留 ``AccountsPage(controller)`` 构造。"""

    def __init__(self, controller) -> None:
        super().__init__(
            controller,
            page_id=PageId.ACCOUNTS,
            title="账户",
            description="账户列表、组标签与权限操作。",
        )
        self._remove_placeholder()
        self._users_snapshot: tuple[parsing.User, ...] | None = None
        self._rows: list[UserRow] = []
        self._empty_mode = ""
        self._buttons = {}
        self._busy = False

        self._build()
        self._connect()

    # -- 装配 --------------------------------------------------------------

    def _remove_placeholder(self) -> None:
        self.placeholder.hide()
        self.body.removeWidget(self.placeholder)
        self.placeholder.setParent(None)
        self.placeholder.deleteLater()

    def _add_body(self, widget: QWidget, stretch: int = 0) -> None:
        self.body.insertWidget(self.body.count() - 1, widget, stretch)

    def _build(self) -> None:
        self._build_header()
        self._build_list()
        self._build_action_bar()

    def _build_header(self) -> None:
        self.count_badge = primitives.Badge(
            "0", "muted", kind="soft", dot=False, parent=self.widget
        )
        self.heading.add(self.count_badge)

        self.refresh_button = primitives.Button(
            "刷新", kind="secondary", size="lg", parent=self.widget
        )
        self.add_button = primitives.Button(
            "+ 添加", kind="primary", size="lg", parent=self.widget
        )
        self.heading.add(self.refresh_button)
        self.heading.add(self.add_button)

    def _build_list(self) -> None:
        self.list_area = QWidget(self.widget)
        area = QVBoxLayout(self.list_area)
        area.setContentsMargins(0, 0, 0, 0)
        area.setSpacing(0)

        self.scroll = QScrollArea(self.list_area)
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.scroll.setVerticalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAsNeeded
        )
        self.container = QWidget()
        self.list_layout = QVBoxLayout(self.container)
        self.list_layout.setContentsMargins(0, 0, 0, 0)
        self.list_layout.setSpacing(0)
        self.list_layout.addStretch(1)
        self.scroll.setWidget(self.container)
        area.addWidget(self.scroll, 1)

        self.empty = QWidget(self.list_area)
        empty_layout = QVBoxLayout(self.empty)
        empty_layout.setContentsMargins(0, 0, 0, 0)
        empty_layout.setSpacing(tokens.space(12))
        empty_layout.addStretch(1)

        self.empty_lock = primitives.LockGlyph("xl", self.empty)
        self.empty_plus = QLabel("＋", self.empty)
        self.empty_plus.setFont(tokens.font(22, 600))
        self.empty_plus.setProperty("tone", "primary")
        self.empty_plus.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_plus.setFixedSize(
            tokens.resolve_size("xl"), tokens.resolve_size("xl")
        )
        empty_layout.addWidget(
            self.empty_lock, 0, Qt.AlignmentFlag.AlignHCenter
        )
        empty_layout.addWidget(
            self.empty_plus, 0, Qt.AlignmentFlag.AlignHCenter
        )

        self.empty_title = QLabel("", self.empty)
        self.empty_title.setFont(tokens.font(15, 600))
        self.empty_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_title.setWordWrap(True)
        empty_layout.addWidget(self.empty_title)

        self.empty_text = QLabel("", self.empty)
        self.empty_text.setFont(tokens.font(12))
        self.empty_text.setProperty("tone", "muted")
        self.empty_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_text.setWordWrap(True)
        empty_layout.addWidget(self.empty_text)

        self.empty_button = primitives.Button(
            "创建 Owner", kind="primary", size="lg", parent=self.empty
        )
        empty_layout.addWidget(
            self.empty_button, 0, Qt.AlignmentFlag.AlignHCenter
        )
        empty_layout.addStretch(1)
        self.empty.setVisible(False)
        area.addWidget(self.empty, 1)

        self._add_body(self.list_area, 1)

    def _build_action_bar(self) -> None:
        self.actions = primitives.Surface(kind="panel", parent=self.widget)
        # 52px 操作条：40px 按钮 + 上下各 6px 内边距，都是设计尺度里的值。
        self.actions.setFixedHeight(tokens.height(40) + tokens.space(12))
        self.actions.body.setContentsMargins(
            tokens.space(16), tokens.space(4), tokens.space(16), tokens.space(4)
        )
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))

        self.selection_label = QLabel("账户操作", self.actions)
        self.selection_label.setFont(tokens.font(12, 500))
        self.selection_label.setProperty("tone", "muted")
        self.selection_name = QLabel("", self.actions)
        self.selection_name.setFont(tokens.font(13, 600))
        self.clear_button = primitives.Button(
            "取消选择", kind="ghost", size="md", parent=self.actions
        )
        self.reset_button = primitives.Button(
            "重置密码", kind="secondary", size="md", parent=self.actions
        )
        self.toggle_button = primitives.Button(
            "禁用", kind="secondary", size="md", parent=self.actions
        )
        self.grant_button = primitives.Button(
            "授予组", kind="secondary", size="md", parent=self.actions
        )
        self.revoke_button = primitives.Button(
            "撤销组", kind="secondary", size="md", parent=self.actions
        )
        self.delete_button = primitives.Button(
            "删除", kind="danger", size="md", parent=self.actions
        )
        separator = QFrame(self.actions)
        separator.setFrameShape(QFrame.Shape.VLine)
        separator.setFrameShadow(QFrame.Shadow.Plain)
        separator.setFixedWidth(1)
        separator.setMinimumHeight(tokens.height(24))

        row.addWidget(self.selection_label)
        row.addWidget(self.selection_name)
        row.addWidget(self.clear_button)
        row.addStretch(1)
        row.addWidget(self.reset_button)
        row.addWidget(self.toggle_button)
        row.addWidget(self.grant_button)
        row.addWidget(self.revoke_button)
        row.addWidget(separator)
        row.addWidget(self.delete_button)
        self.actions.body.addLayout(row)
        self._add_body(self.actions)

    def _connect(self) -> None:
        self.refresh_button.clicked.connect(self.controller.refresh_users)
        self.add_button.clicked.connect(self._add_account)
        self.empty_button.clicked.connect(self._empty_action)
        self.clear_button.clicked.connect(
            lambda: self.controller.select_user(None)
        )
        self.reset_button.clicked.connect(self._reset_password)
        self.toggle_button.clicked.connect(self._toggle_user)
        self.grant_button.clicked.connect(lambda: self._change_group(True))
        self.revoke_button.clicked.connect(lambda: self._change_group(False))
        self.delete_button.clicked.connect(self._delete_user)

    # -- 列表 --------------------------------------------------------------

    def _rebuild_rows(self, users: tuple[parsing.User, ...]) -> None:
        bar = self.scroll.verticalScrollBar()
        offset = bar.value()

        for row in self._rows:
            self.list_layout.removeWidget(row)
            row.setParent(None)
            row.deleteLater()
        self._rows.clear()

        for user in users:
            row = UserRow(user, self.container)
            row.clicked.connect(lambda row=row: self._on_row_clicked(row))
            row.activated.connect(lambda row=row: self._on_row_clicked(row))
            row.toggled.connect(
                lambda checked, row=row: self._on_row_toggled(row, checked)
            )
            row.upPressed.connect(
                lambda row=row: self._move_selection(row, -1)
            )
            row.downPressed.connect(
                lambda row=row: self._move_selection(row, 1)
            )
            self.list_layout.insertWidget(
                self.list_layout.count() - 1, row
            )
            self._rows.append(row)

        # 先让布局算出新的滚动范围，否则 0ms 后恢复时 maximum 还是 0。
        self.list_layout.activate()
        self.container.adjustSize()
        QTimer.singleShot(0, lambda: self._restore_scroll(offset))

    def _restore_scroll(self, offset: int) -> None:
        try:
            bar = self.scroll.verticalScrollBar()
        except RuntimeError:
            return
        bar.setValue(min(offset, bar.maximum()))

    def _sync_selection(self, selected: str | None) -> None:
        for row in self._rows:
            row.set_selected(row.key == selected)

    def _on_row_clicked(self, row: UserRow) -> None:
        row.setFocus()
        self.controller.select_user(row.key)

    def _on_row_toggled(self, row: UserRow, checked: bool) -> None:
        self.controller.select_user(row.key if checked else None)

    def _move_selection(self, row: UserRow, delta: int) -> None:
        if not self._rows:
            return
        try:
            index = self._rows.index(row)
        except ValueError:
            index = 0
        target = max(0, min(len(self._rows) - 1, index + delta))
        target_row = self._rows[target]
        target_row.setFocus()
        self.controller.select_user(target_row.key)

    # -- 动作 --------------------------------------------------------------

    def _selected_user(self) -> parsing.User | None:
        state = self.controller.state
        if state.selected is None:
            return None
        return next(
            (user for user in state.users if user.username == state.selected),
            None,
        )

    def _add_account(self) -> None:
        identity = self.controller.state.identity
        allow_groups = bool(identity is not None and identity.is_owner)
        form = AccountForm(
            self.widget, mode="user", allow_groups=allow_groups
        )
        value = form.exec_modal()
        if isinstance(value, tuple) and len(value) == 3:
            username, password, groups = value
            self.controller.add_user(username, password, groups)

    def _create_owner(self) -> None:
        form = AccountForm(self.widget, mode="owner")
        value = form.exec_modal()
        if isinstance(value, tuple) and len(value) == 3:
            username, password, _groups = value
            self.controller.setup_owner(username, password)

    def _empty_action(self) -> None:
        if self._empty_mode == "login":
            self.controller.ensure_login()
        elif self._empty_mode == "setup_owner":
            self._create_owner()
        elif self._empty_mode == "empty":
            self._add_account()

    def _reset_password(self) -> None:
        user = self._selected_user()
        if user is None:
            return
        form = PasswordForm(self.widget, user.username)
        value = form.exec_modal()
        if isinstance(value, str) and value:
            self.controller.reset_password(user.username, value)

    def _toggle_user(self) -> None:
        user = self._selected_user()
        if user is None:
            return
        self.controller.set_user_enabled(user.username, enabled=user.disabled)

    def _change_group(self, add: bool) -> None:
        user = self._selected_user()
        if user is None:
            return
        form = GroupForm(self.widget, user.username, add=add)
        value = form.exec_modal()
        if isinstance(value, str) and value:
            self.controller.change_group(user.username, value, add)

    def _delete_user(self) -> None:
        user = self._selected_user()
        if user is None:
            return
        if ask_confirm(
            self.widget,
            DELETE_TITLE,
            DELETE_MESSAGE.format(username=user.username),
            danger=True,
        ):
            self.controller.delete_user(user.username)

    # -- 渲染 --------------------------------------------------------------

    def _apply_verdict(self, widget, action: ActionId) -> None:
        verdict = self._buttons.get(action)
        if verdict is not None:
            render.apply_verdict(widget, verdict)

    def render(self, ui: "UiState", state: "AppState | None") -> None:
        if state is None:
            return
        self._buttons = dict(ui.buttons)
        self._busy = bool(ui.busy)

        if state.users != self._users_snapshot:
            self._users_snapshot = state.users
            self._rebuild_rows(state.users)
        self._sync_selection(state.selected)

        self._render_header(ui, state)
        self._render_empty(state)
        self._render_actions(ui, state)

    def _render_header(self, ui: "UiState", state: "AppState") -> None:
        text = str(len(state.users))
        if self.count_badge.text() != text:
            self.count_badge.setText(text)
        self._apply_verdict(self.refresh_button, ActionId.REFRESH_USERS)
        self._apply_verdict(self.add_button, ActionId.ADD_USER)

    def _render_empty(self, state: "AppState") -> None:
        host = rules.host_config(state)
        identity = state.identity
        mode = ""
        title = ""
        text = ""
        icon = ""
        action: ActionId | None = None

        if host is None:
            mode = "loading"
            title = EMPTY_LOADING_TITLE
        elif not host.initialized:
            mode = "setup_owner"
            title = EMPTY_NO_ACCOUNT_TITLE
            text = EMPTY_NO_ACCOUNT_TEXT
            icon = "plus"
            action = ActionId.SETUP_OWNER
        elif identity is None:
            mode = "login"
            title = EMPTY_LOGIN_TITLE
            text = EMPTY_LOGIN_TEXT
            icon = "lock"
            action = ActionId.LOGIN
        elif not state.users:
            mode = "empty"
            title = EMPTY_NO_ACCOUNT_TITLE
            text = EMPTY_ADD_TEXT
            icon = "plus"
            action = ActionId.ADD_USER

        self._empty_mode = mode
        self.scroll.setVisible(mode == "")
        self.empty.setVisible(mode != "")

        if not mode:
            return

        if self.empty_title.text() != title:
            self.empty_title.setText(title)
        self.empty_text.setText(text)
        self.empty_text.setVisible(bool(text))
        self.empty_lock.setVisible(icon == "lock")
        self.empty_plus.setVisible(icon == "plus")
        self.empty_button.setVisible(action is not None)
        if action is not None:
            self._apply_verdict(self.empty_button, action)

    def _render_actions(self, ui: "UiState", state: "AppState") -> None:
        user = self._selected_user()
        self.selection_label.setText("已选择" if user is not None else "账户操作")
        self.selection_name.setText(user.username if user is not None else "")
        self.clear_button.setVisible(user is not None)
        self.clear_button.setEnabled(user is not None and not self._busy)

        self._apply_verdict(self.reset_button, ActionId.RESET_PASSWORD)
        self._apply_verdict(self.toggle_button, ActionId.TOGGLE_USER)
        self._apply_verdict(self.grant_button, ActionId.GRANT)
        self._apply_verdict(self.revoke_button, ActionId.REVOKE)
        self._apply_verdict(self.delete_button, ActionId.DELETE_USER)
