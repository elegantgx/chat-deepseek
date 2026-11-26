"""安装 / 更新 systemd 服务。

用户目录直接返回安装参数，由 controller 执行；系统目录需要 root，GUI 只
生成“安装命令”和“CLI 帮助”两条复制命令，不执行、也不提权。命令统一由
``service_plan`` 拼装，带远端 SSH 前缀。
"""

from __future__ import annotations

from PySide6.QtWidgets import QHBoxLayout, QWidget

import service_plan

from .. import forms, primitives, tokens
from .base import SheetDialog

SCOPES = ("user", "system")


class ServiceInstallSheet(SheetDialog):
    """安装/更新表单；``value`` 为 ``dict``，取消或系统目录关闭时为 ``None``。"""

    def __init__(
        self,
        parent: QWidget | None,
        *,
        binary: str,
        data_dir: str,
        linger: bool,
        username: str,
        host: str = "",
        installed: bool = False,
        enabled: bool = False,
        active: bool = False,
        reset_ms: int = 1500,
    ) -> None:
        title = "更新服务" if installed else "安装服务"
        super().__init__(
            parent, title, "", width=720, body_max_height=380
        )
        self.binary = binary
        self.data_dir = data_dir
        self.username = username or "<user>"
        self.host = host.strip()
        self.installed = bool(installed)
        self.linger = bool(linger)
        self.active = bool(active)
        self.scope = "user"

        self.grid = forms.FormGrid(self._content)
        self.add(self.grid)

        self.scope_field: primitives.Field | None = None
        if not self.installed:
            self.scope_field = primitives.Field(
                kind="select",
                options=[("user", "用户目录"), ("system", "系统目录")],
                size="xl",
            )
            self.scope_field.setAccessibleName("安装位置")
            self.scope_field.changed.connect(self._set_scope)
            self.grid.add(
                forms.FormRow("安装位置", self.scope_field), key="scope"
            )

        self.enable = primitives.Switch()
        self.enable.setChecked(True if not self.installed else bool(enabled))
        self.grid.add(
            forms.FormRow("开机自启", self._switch_holder(self.enable)),
            key="enable",
        )

        if self.installed:
            start_label = "更新后重启服务" if active else "更新后启动服务"
        else:
            start_label = "安装后立即启动"
        self.start = primitives.Switch()
        self.start.setChecked(True)
        self.start_row = forms.FormRow(
            start_label, self._switch_holder(self.start)
        )
        self.grid.add(self.start_row, key="start")

        self.linger_row = forms.CopyRow(
            "linger", self._linger_command(), reset_ms=reset_ms, parent=self
        )
        self.grid.add(self.linger_row, key="linger")

        self.install_row = forms.CopyRow(
            "安装命令", self._install_command(), reset_ms=reset_ms, parent=self
        )
        self.grid.add(self.install_row, key="install_command")

        self.help_row = forms.CopyRow(
            "CLI 帮助",
            service_plan.service_help_command(self.binary, host=self.host),
            reset_ms=reset_ms,
            parent=self,
        )
        self.grid.add(self.help_row, key="help")

        self.enable.toggled.connect(self._update_install_command)

        primary = "更新" if self.installed else "安装"
        self.buttons(primary, self._ok)
        self._sync_scope()

    # -- 行布局 ------------------------------------------------------------

    def _switch_holder(self, switch: primitives.Switch) -> QWidget:
        holder = QWidget()
        holder.setFixedHeight(tokens.height(40))
        row = QHBoxLayout(holder)
        row.setContentsMargins(0, 0, 0, 0)
        row.addStretch(1)
        row.addWidget(switch, 0)
        return holder

    # -- 命令 --------------------------------------------------------------

    def _linger_command(self) -> str:
        # 与旧对话框一致：已开 linger 时显示关闭命令，未开时显示开启命令。
        return service_plan.linger_command(
            self.username, enable=not self.linger, host=self.host
        )

    def _install_command(self) -> str:
        return service_plan.system_install_command(
            self.binary,
            self.data_dir,
            run_as=self.username,
            enable=self.enable.isChecked(),
            host=self.host,
        )

    def _update_install_command(self, *_args) -> None:
        if not hasattr(self, "install_row"):
            return
        self.install_row.setText(self._install_command())

    # -- 作用域 ------------------------------------------------------------

    def _set_scope(self, scope: str) -> None:
        if scope not in SCOPES or scope == self.scope:
            return
        self.scope = scope
        self._sync_scope()
        if self.isVisible():
            self._fit_body()
            self.adjustSize()

    def _sync_scope(self) -> None:
        system = self.scope == "system"
        self.grid.set_visible(["start", "linger"], not system)
        self.grid.set_visible(["install_command", "help"], system)
        if self.primary_button is not None:
            self.primary_button.setVisible(not system)
        if self.cancel_button is not None:
            self.cancel_button.setText("关闭" if system else "取消")
        if system:
            # 系统目录只给命令；主按钮隐藏，关闭成为默认。
            if self.cancel_button is not None:
                self.set_default_button(self.cancel_button)
            self._initial_focus = self.cancel_button
            self._update_install_command()
        else:
            if self.primary_button is not None:
                self.set_default_button(self.primary_button)
            self._initial_focus = None

    # -- 结果 --------------------------------------------------------------

    def _ok(self) -> None:
        if self.scope != "user":
            # 系统目录需要 root；GUI 不执行命令，也不返回安装参数。
            return
        self.value = {
            "scope": self.scope,
            "enable": bool(self.enable.isChecked()),
            "start": bool(self.start.isChecked()),
            "force": self.installed,
        }
        self.accept()
