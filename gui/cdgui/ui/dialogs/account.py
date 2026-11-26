"""账户表单：创建第一个 Owner 或添加普通用户。

Owner 模式没有组；只有 Owner 登录时（``allow_groups=True``）才显示
Admin / Owner 附加组。两个角色共用同一套用户名、密码与确认校验。
"""

from __future__ import annotations

from PySide6.QtWidgets import QHBoxLayout, QWidget

from ...domain import validation
from .. import forms, primitives, tokens
from .base import FormDialog

MODES = ("owner", "user")


class AccountForm(FormDialog):
    """创建 Owner / 添加用户；``value`` 为 ``(username, password, groups)``。

    取消时 ``value`` 保持 ``None``。``groups`` 是附加组元组，普通用户至少
    属于 ``User``，但不把默认组写进这个返回值（与旧对话框一致）。
    """

    def __init__(
        self,
        parent: QWidget | None,
        mode: str = "owner",
        allow_groups: bool = False,
    ) -> None:
        if mode not in MODES:
            raise ValueError(f"未知账户模式：{mode!r}")
        self.mode = mode
        self.allow_groups = bool(allow_groups) and mode == "user"

        if mode == "owner":
            title = "创建 Owner"
            description = "第一个账户会成为 Owner。"
        else:
            title = "添加用户"
            if self.allow_groups:
                description = "新用户默认属于 User 组，可附加 Admin 或 Owner。"
            else:
                description = "新用户默认属于 User 组；Admin 不能指定附加组。"

        super().__init__(
            parent,
            title,
            description,
            width=480,
            submit_text="创建",
            body_max_height=320,
        )

        self.username = primitives.Field(
            kind="text", placeholder="用户名", size="xl"
        )
        self.password = primitives.Field(
            kind="text", placeholder="至少 8 位", password=True, size="xl"
        )
        self.confirm = primitives.Field(
            kind="text", placeholder="再次输入密码", password=True, size="xl"
        )
        self.grid.add(forms.FormRow("用户名", self.username), key="username")
        self.grid.add(forms.FormRow("密码", self.password), key="password")
        self.grid.add(forms.FormRow("再次输入", self.confirm), key="confirm")

        self.admin: primitives.Choice | None = None
        self.owner: primitives.Choice | None = None
        if self.allow_groups:
            holder = QWidget()
            row = QHBoxLayout(holder)
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(tokens.space(20))
            self.admin = primitives.Choice("Admin", kind="check")
            self.owner = primitives.Choice("Owner", kind="check")
            row.addWidget(self.admin)
            row.addWidget(self.owner)
            row.addStretch(1)
            self.grid.add(forms.FormRow("附加组", holder), key="groups")

        self.username.returnPressed.connect(self.password.setFocus)
        self.password.returnPressed.connect(self.confirm.setFocus)
        self.confirm.returnPressed.connect(self.submit)
        self._initial_focus = self.username

    def form_error(self) -> str:
        if not self.username.text().strip():
            return "用户名不能为空"
        password = self.password.text()
        error = validation.password_error(password)
        if error:
            return error
        return validation.password_confirm_error(password, self.confirm.text())

    def form_value(self):
        groups: list[str] = []
        if self.mode == "user":
            if self.admin is not None and self.admin.isChecked():
                groups.append("Admin")
            if self.owner is not None and self.owner.isChecked():
                groups.append("Owner")
        return (self.username.text().strip(), self.password.text(), tuple(groups))
