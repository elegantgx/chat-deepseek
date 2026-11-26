"""设置页：连接草稿、服务端配置、管理登录与关于。

整页放在 ``QScrollArea`` 里，不再固定高度。连接卡的两套路径行共用一张
``FormGrid``，切换连接方式时只显隐对应行；标签列天然对齐。连接草稿在
``Target.key`` 或 ``config.gui.json`` 变化时从 ``controller.config`` 重置，
离开页面前用 ``can_leave`` 拦一次未保存修改。
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from ...domain import rules, validation
from ...domain.rules import ActionId
from ...domain.state import PageId
from ...domain.target import (
    ConnectionKind,
    Endpoint,
    TargetError,
    resolve_target,
)
from .. import primitives, tokens
from ..dialogs import ask_confirm
from ..forms import FormGrid, FormRow, PathRow
from .base import Page

if TYPE_CHECKING:
    from ...domain.facts import HostConfig
    from ...domain.state import AppState
    from ..protocols import ControllerProtocol
    from ..render import UiState

CONNECTION_OPTIONS = (("local", "本机"), ("ssh", "SSH 远程"))
DISCARD_TITLE = "放弃修改"
DISCARD_MESSAGE = "连接设置还没应用，离开会丢失修改。"

_BACKUP_PLACEHOLDER = "留空表示数据目录下的 backups/"
_LISTEN_PLACEHOLDER = "监听地址"
_PUBLIC_PLACEHOLDER = "未设置"
_API_PLACEHOLDER = "API 地址"
_LOADING_PLACEHOLDER = "正在读取…"

_LOCAL_KEYS = ("local_binary", "local_data")
_SSH_KEYS = ("ssh_host", "ssh_binary", "ssh_data")


def _set_text(widget, text: str) -> None:
    setter = getattr(widget, "setText", None)
    getter = getattr(widget, "text", None)
    if callable(setter) and callable(getter) and getter() != text:
        setter(text)


def _set_visible(widget: QWidget, visible: bool) -> None:
    if widget.isHidden() == bool(visible):
        widget.setVisible(bool(visible))


def _apply_verdict(widget: QWidget, verdict) -> None:
    # 延迟导入，避免 render → views → pages 的模块循环。
    from ..render import apply_verdict

    apply_verdict(widget, verdict)


class SettingsPage(Page):
    """设置页。"""

    def __init__(self, controller: "ControllerProtocol") -> None:
        super().__init__(
            controller,
            page_id=PageId.SETTINGS,
            title="设置",
            description="",
        )
        self._target_key: str | None = None
        self._config_signature: tuple[str, str, str, str, str, str] | None = None
        self._baseline: dict[str, str] = {}
        self._remote_mode: bool | None = None
        self._server_signature: object | None = None
        self._build_shell()
        # 页面还没渲染过时不能把空表单当成“未保存修改”。
        self._baseline = self._form_values()

    # -- 外壳 --------------------------------------------------------------

    def _build_shell(self) -> None:
        """把骨架的固定 body 换成整页 QScrollArea。"""
        self.body.removeWidget(self.placeholder)
        self.placeholder.deleteLater()
        while self.body.count():
            item = self.body.takeAt(0)
            widget = item.widget()
            if widget is not None and widget is not self.heading:
                widget.deleteLater()

        self.body.setContentsMargins(0, 0, 0, 0)
        self.body.setSpacing(0)
        self.scroll = QScrollArea(self.widget)
        self.scroll.setObjectName("cdguiSettingsScroll")
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.content = QWidget(self.scroll)
        self.content_layout = QVBoxLayout(self.content)
        self.content_layout.setContentsMargins(
            tokens.space(24), tokens.space(20), tokens.space(24), tokens.space(20)
        )
        self.content_layout.setSpacing(tokens.space(12))
        self.heading.setParent(self.content)
        self.content_layout.addWidget(self.heading)

        self.connection_card = self._build_connection_card()
        self.content_layout.addWidget(self.connection_card)
        self.server_card = self._build_server_card()
        self.content_layout.addWidget(self.server_card)
        self.login_card = self._build_login_card()
        self.content_layout.addWidget(self.login_card)
        self.about_card = self._build_about_card()
        self.content_layout.addWidget(self.about_card)
        self.content_layout.addStretch(1)

        self.scroll.setWidget(self.content)
        self.body.addWidget(self.scroll)

    # -- 连接卡 ------------------------------------------------------------

    def _build_connection_card(self) -> primitives.Surface:
        card = primitives.Surface("card", self.content)
        card.body.addWidget(primitives.SectionHeading("连接", card))

        self.connection_grid = FormGrid(card)
        self.mode = primitives.Field(
            kind="select",
            options=[(value, label) for value, label in CONNECTION_OPTIONS],
            size="xl",
            parent=card,
        )
        self.mode.setAccessibleName("连接方式")
        self.mode.changed.connect(self._on_mode_changed)
        self.connection_grid.add(
            FormRow("连接方式", self.mode, parent=card), key="mode"
        )

        self.local_binary = PathRow(
            placeholder="chat-deepseek 所在目录或可执行文件",
            browse=self._browse_local_binary,
            parent=card,
        )
        self.local_data = PathRow(
            placeholder="数据目录",
            browse=self._browse_local_data,
            parent=card,
        )
        self.connection_grid.add(
            FormRow("二进制目录", self.local_binary, parent=card),
            key="local_binary",
        )
        self.connection_grid.add(
            FormRow("数据目录", self.local_data, parent=card),
            key="local_data",
        )

        self.ssh_host = primitives.Field(
            kind="text",
            placeholder="nas 或 user@nas",
            size="xl",
            parent=card,
        )
        self.ssh_binary = primitives.Field(
            kind="text",
            placeholder="/home/you/chat-deepseek",
            size="xl",
            parent=card,
        )
        self.ssh_data = primitives.Field(
            kind="text",
            placeholder="留空使用远端默认数据目录",
            size="xl",
            parent=card,
        )
        self.connection_grid.add(
            FormRow("SSH 主机", self.ssh_host, parent=card), key="ssh_host"
        )
        self.connection_grid.add(
            FormRow("远端二进制目录", self.ssh_binary, parent=card),
            key="ssh_binary",
        )
        self.connection_grid.add(
            FormRow("远端数据目录", self.ssh_data, parent=card),
            key="ssh_data",
        )
        card.body.addWidget(self.connection_grid)

        self.connection_error = self._error_label(card, "cdguiSettingsConnectionError")
        card.body.addWidget(self.connection_error)

        buttons = QHBoxLayout()
        buttons.setContentsMargins(0, 0, 0, 0)
        buttons.setSpacing(tokens.space(8))
        buttons.addStretch(1)
        self.test_button = primitives.Button(
            "测试连接", kind="secondary", size="lg", parent=card
        )
        self.test_button.clicked.connect(self._test_connection)
        buttons.addWidget(self.test_button)
        self.apply_button = primitives.Button(
            "应用切换", kind="primary", size="lg", parent=card
        )
        self.apply_button.clicked.connect(self._apply_target)
        buttons.addWidget(self.apply_button)
        card.body.addLayout(buttons)
        return card

    # -- 服务端配置卡 ------------------------------------------------------

    def _build_server_card(self) -> primitives.Surface:
        card = primitives.Surface("card", self.content)
        heading = primitives.SectionHeading("服务端配置", card)
        self.server_badge = primitives.Badge("", tone="muted", dot=False, parent=card)
        # 放在标题正文之后、stretch 之前，读起来是“服务端配置 来自 …”。
        heading.row.insertWidget(1, self.server_badge)
        card.body.addWidget(heading)

        self.server_grid = FormGrid(card)
        self.server_backup = PathRow(
            placeholder=_BACKUP_PLACEHOLDER,
            browse=self._browse_server_backup,
            parent=card,
        )
        self.server_listen = primitives.Field(
            kind="text", placeholder=_LISTEN_PLACEHOLDER, size="xl", parent=card
        )
        self.server_public_url = primitives.Field(
            kind="text", placeholder=_PUBLIC_PLACEHOLDER, size="xl", parent=card
        )
        self.server_api_origin = primitives.Field(
            kind="text", placeholder=_API_PLACEHOLDER, size="xl", parent=card
        )
        self.server_grid.add(
            FormRow("备份地址", self.server_backup, parent=card),
            key="server_backup",
        )
        self.server_grid.add(
            FormRow("监听地址", self.server_listen, parent=card),
            key="server_listen",
        )
        self.server_grid.add(
            FormRow("Public URL", self.server_public_url, parent=card),
            key="server_public_url",
        )
        self.server_grid.add(
            FormRow("API 地址", self.server_api_origin, parent=card),
            key="server_api_origin",
        )
        self._server_rows = {
            "backup_dir": self.server_grid.row("server_backup"),
            "listen": self.server_grid.row("server_listen"),
            "public_url": self.server_grid.row("server_public_url"),
            "api_origin": self.server_grid.row("server_api_origin"),
        }
        self._server_controls = {
            "backup_dir": self.server_backup,
            "listen": self.server_listen,
            "public_url": self.server_public_url,
            "api_origin": self.server_api_origin,
        }
        card.body.addWidget(self.server_grid)

        self.server_hint = QLabel(
            "这四项写入当前目标主机的 config.json；另一台主机的值需要切换后再读。",
            card,
        )
        self.server_hint.setFont(tokens.font(11))
        self.server_hint.setProperty("tone", "muted")
        self.server_hint.setWordWrap(True)
        card.body.addWidget(self.server_hint)

        self.server_error = self._error_label(card, "cdguiSettingsServerError")
        card.body.addWidget(self.server_error)

        buttons = QHBoxLayout()
        buttons.setContentsMargins(0, 0, 0, 0)
        buttons.setSpacing(tokens.space(8))
        buttons.addStretch(1)
        self.save_server_button = primitives.Button(
            "保存配置", kind="primary", size="lg", parent=card
        )
        self.save_server_button.clicked.connect(self._save_server_config)
        buttons.addWidget(self.save_server_button)
        card.body.addLayout(buttons)
        return card

    # -- 管理登录卡 --------------------------------------------------------

    def _build_login_card(self) -> primitives.Surface:
        card = primitives.Surface("card", self.content)
        card.body.addWidget(primitives.SectionHeading("管理登录", card))
        self.login_grid = FormGrid(card)
        self.identity_field = self._readonly_field(card)
        self.groups_field = self._readonly_field(card)
        self.expires_field = self._readonly_field(card)
        self.login_grid.add(
            FormRow("身份", self.identity_field, parent=card), key="identity"
        )
        self.login_grid.add(
            FormRow("组", self.groups_field, parent=card), key="groups"
        )
        self.login_grid.add(
            FormRow("过期时间", self.expires_field, parent=card), key="expires"
        )
        card.body.addWidget(self.login_grid)

        buttons = QHBoxLayout()
        buttons.setContentsMargins(0, 0, 0, 0)
        buttons.setSpacing(tokens.space(8))
        self.login_hint = QLabel("未登录", card)
        self.login_hint.setFont(tokens.font(12))
        self.login_hint.setProperty("tone", "muted")
        buttons.addWidget(self.login_hint, 1)
        self.logout_button = primitives.Button(
            "退出登录", kind="secondary", size="lg", parent=card
        )
        self.logout_button.clicked.connect(lambda: self.controller.logout())
        buttons.addWidget(self.logout_button)
        card.body.addLayout(buttons)
        return card

    # -- 关于卡 ------------------------------------------------------------

    def _build_about_card(self) -> primitives.Surface:
        card = primitives.Surface("card", self.content)
        card.body.addWidget(primitives.SectionHeading("关于", card))
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))
        self.version_label = QLabel("chat-deepseek", card)
        self.version_label.setObjectName("cdguiSettingsVersion")
        self.version_label.setFont(tokens.font(12))
        self.version_label.setProperty("tone", "muted")
        self.version_label.setWordWrap(True)
        row.addWidget(self.version_label, 1)
        self.help_button = primitives.Button(
            "命令行帮助", kind="secondary", size="lg", parent=card
        )
        self.help_button.clicked.connect(lambda: self.controller.show_help())
        row.addWidget(self.help_button, 0, Qt.AlignmentFlag.AlignVCenter)
        card.body.addLayout(row)
        return card

    # -- 小工具 ------------------------------------------------------------

    def _error_label(self, parent: QWidget, object_name: str) -> QLabel:
        label = QLabel("", parent)
        label.setObjectName(object_name)
        label.setFont(tokens.font(12))
        label.setProperty("tone", "danger")
        label.setWordWrap(True)
        label.setVisible(False)
        return label

    def _readonly_field(self, parent: QWidget) -> primitives.Field:
        return primitives.Field(kind="readonly", size="xl", parent=parent)

    def _show_error(self, label: QLabel, message: str) -> None:
        _set_text(label, message)
        _set_visible(label, bool(message))

    def _host_label(self, state: "AppState") -> str:
        if state.target.remote:
            return f" SSH 主机 {state.target.host} "
        return "本机"

    # -- 浏览 --------------------------------------------------------------

    def _pick_directory(self, caption: str, start: str) -> str | None:
        path = QFileDialog.getExistingDirectory(
            self.widget, caption, start or ""
        )
        return path or None

    def _browse_local_binary(self, _parent) -> str | None:
        return self._pick_directory("选择二进制目录", self.local_binary.text())

    def _browse_local_data(self, _parent) -> str | None:
        return self._pick_directory("选择数据目录", self.local_data.text())

    def _browse_server_backup(self, _parent) -> str | None:
        if self.controller.state.target.remote:
            return None
        return self._pick_directory("选择备份目录", self.server_backup.text())

    # -- 草稿 --------------------------------------------------------------

    def _form_values(self) -> dict[str, str]:
        return {
            "mode": self.mode.value(),
            "local_binary": self.local_binary.text().strip(),
            "local_data": self.local_data.text().strip(),
            "ssh_host": self.ssh_host.text().strip(),
            "ssh_binary": self.ssh_binary.text().strip(),
            "ssh_data": self.ssh_data.text().strip(),
        }

    @staticmethod
    def _signature(config) -> tuple[str, str, str, str, str, str]:
        return (
            config.connection,
            config.local.binary_dir,
            config.local.data_dir,
            config.ssh.host,
            config.ssh.binary_dir,
            config.ssh.data_dir,
        )

    def _load_draft(self) -> None:
        config = self.controller.config
        mode = config.connection if config.connection in ("local", "ssh") else "local"
        self.mode.setValue(mode)
        self.local_binary.setText(config.local.binary_dir)
        self.local_data.setText(config.local.data_dir)
        self.ssh_host.setText(config.ssh.host)
        self.ssh_binary.setText(config.ssh.binary_dir)
        self.ssh_data.setText(config.ssh.data_dir)
        self._baseline = self._form_values()
        self._show_error(self.connection_error, "")
        self._sync_mode_visibility()

    def _sync_draft(self, state: "AppState") -> None:
        config = self.controller.config
        signature = self._signature(config)
        if (
            self._target_key is None
            or state.target.key != self._target_key
            or signature != self._config_signature
        ):
            self._target_key = state.target.key
            self._config_signature = signature
            self._load_draft()
        self._sync_mode_visibility()

    def is_dirty(self) -> bool:
        """连接表单是否有未应用的改动。"""
        return self._form_values() != self._baseline

    def can_leave(self) -> bool:
        if not self.is_dirty():
            return True
        return bool(
            ask_confirm(
                self.widget,
                DISCARD_TITLE,
                DISCARD_MESSAGE,
                danger=False,
            )
        )

    # -- 模式显隐 ----------------------------------------------------------

    def _on_mode_changed(self, _value: str) -> None:
        self._sync_mode_visibility()
        self._show_error(self.connection_error, "")

    def _sync_mode_visibility(self) -> None:
        remote = self.mode.value() == "ssh"
        if remote == self._remote_mode:
            return
        self._remote_mode = remote
        self.connection_grid.set_visible(_LOCAL_KEYS, not remote)
        self.connection_grid.set_visible(_SSH_KEYS, remote)

    # -- 连接动作 ----------------------------------------------------------

    def _endpoint(self) -> Endpoint | None:
        kind = ConnectionKind(self.mode.value())
        if kind is ConnectionKind.LOCAL:
            endpoint = Endpoint(
                kind=kind,
                host="",
                binary_dir=self.local_binary.text().strip(),
                data_dir=self.local_data.text().strip(),
            )
        else:
            endpoint = Endpoint(
                kind=kind,
                host=self.ssh_host.text().strip(),
                binary_dir=self.ssh_binary.text().strip(),
                data_dir=self.ssh_data.text().strip(),
            )
        try:
            resolve_target(endpoint)
        except TargetError as exc:
            self._show_error(self.connection_error, str(exc))
            return None
        self._show_error(self.connection_error, "")
        return endpoint

    def _test_connection(self) -> None:
        endpoint = self._endpoint()
        if endpoint is None:
            return
        self.controller.test_connection(endpoint)

    def _apply_target(self) -> None:
        endpoint = self._endpoint()
        if endpoint is None:
            return
        self.controller.apply_target(endpoint)

    # -- 服务端配置 --------------------------------------------------------

    def _server_values(self) -> dict[str, str]:
        return {
            "backup_dir": self.server_backup.text().strip(),
            "listen": self.server_listen.text().strip(),
            "public_url": self.server_public_url.text().strip(),
            "api_origin": self.server_api_origin.text().strip(),
        }

    def _server_signature_of(self, state: "AppState", host: "HostConfig | None"):
        if host is None:
            return (state.target.key, None)
        return (
            state.target.key,
            host.target_key,
            host.backup_dir,
            host.listen,
            host.public_url,
            host.api_origin,
        )

    def _set_control_text(self, control, value: str) -> None:
        setter = getattr(control, "setText", None)
        if callable(setter):
            setter(value)

    def _set_control_placeholder(self, control, value: str) -> None:
        setter = getattr(control, "setPlaceholderText", None)
        if callable(setter):
            setter(value)

    def _sync_server_fields(
        self, state: "AppState", host: "HostConfig | None"
    ) -> None:
        signature = self._server_signature_of(state, host)
        if signature == self._server_signature:
            return
        self._server_signature = signature
        if host is None:
            for row in self._server_rows.values():
                if row is not None:
                    row.set_mode("disabled")
            for key, control in self._server_controls.items():
                self._set_control_text(control, "")
                self._set_control_placeholder(control, _LOADING_PLACEHOLDER)
                control.setEnabled(False)
            return
        values = {
            "backup_dir": host.backup_dir,
            "listen": host.listen,
            "public_url": host.public_url,
            "api_origin": host.api_origin,
        }
        placeholders = {
            "backup_dir": _BACKUP_PLACEHOLDER,
            "listen": _LISTEN_PLACEHOLDER,
            "public_url": _PUBLIC_PLACEHOLDER,
            "api_origin": _API_PLACEHOLDER,
        }
        for key, control in self._server_controls.items():
            self._set_control_text(control, values[key])
            self._set_control_placeholder(control, placeholders[key])
            control.setEnabled(True)
        for row in self._server_rows.values():
            if row is not None:
                row.set_mode("edit")

    def _save_server_config(self) -> None:
        state = self.controller.state
        host = rules.host_config(state)
        if host is None:
            self._show_error(self.server_error, "正在读取目标主机配置…")
            return
        values = self._server_values()
        remote = state.target.remote
        error = (
            validation.backup_dir_error(values["backup_dir"], remote=remote)
            or validation.listen_error(values["listen"])
            or validation.public_url_error(values["public_url"])
            or validation.api_origin_error(values["api_origin"])
        )
        if error:
            self._show_error(self.server_error, error)
            return
        self._show_error(self.server_error, "")
        self.controller.save_server_config(values)

    # -- 渲染 --------------------------------------------------------------

    def render(self, ui: "UiState", state: "AppState | None") -> None:
        if state is None:
            state = self.controller.state
        self._sync_draft(state)
        self._sync_mode_visibility()
        _apply_verdict(self.test_button, ui.buttons[ActionId.TEST_CONNECTION])
        _apply_verdict(
            self.apply_button, ui.buttons[ActionId.SETTINGS_APPLY_TARGET]
        )
        self._render_server(ui, state)
        self._render_login(ui, state)
        _apply_verdict(self.help_button, ui.buttons[ActionId.HELP])
        _set_text(self.version_label, ui.version_label)

    def _render_server(self, ui: "UiState", state: "AppState") -> None:
        host = rules.host_config(state)
        _set_text(
            self.server_badge,
            f"来自{self._host_label(state)}的 config.json",
        )
        self._sync_server_fields(state, host)
        _set_visible(self.server_backup.browse_button, not state.target.remote)
        _apply_verdict(
            self.save_server_button, ui.buttons[ActionId.SETTINGS_SAVE_SERVER]
        )

    def _render_login(self, ui: "UiState", state: "AppState") -> None:
        identity = state.identity
        if identity is None:
            _set_text(self.identity_field, "未登录")
            _set_text(self.groups_field, "—")
            _set_text(self.expires_field, "—")
            _set_text(self.login_hint, "未登录；登录后可管理账户与备份。")
        else:
            _set_text(
                self.identity_field, f"{identity.username}（{identity.role}）"
            )
            _set_text(self.groups_field, identity.groups_text)
            expires = identity.expires_at.strftime("%Y-%m-%d %H:%M:%S")
            remaining = rules.remaining_text(identity, datetime.now())
            _set_text(self.expires_field, f"{expires}（{remaining}）")
            _set_text(self.login_hint, "登录态只对当前目标主机有效。")
        _apply_verdict(self.logout_button, ui.buttons[ActionId.LOGOUT])
