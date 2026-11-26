"""重置密码表单：新密码 + 再次输入，返回字符串或 ``None``。"""

from __future__ import annotations

from PySide6.QtWidgets import QWidget

from ...domain import validation
from .. import forms, primitives
from .base import FormDialog


class PasswordForm(FormDialog):
    """为指定账户设置新密码；``value`` 为密码字符串，取消时为 ``None``。"""

    def __init__(self, parent: QWidget | None, username: str = "") -> None:
        self.username = username
        if username:
            description = f"为 {username} 设置新密码，至少 8 位。"
        else:
            description = "至少 8 位。"
        super().__init__(
            parent,
            "重置密码",
            description,
            width=460,
            submit_text="保存",
            body_max_height=240,
        )

        self.password = primitives.Field(
            kind="text", placeholder="新密码", password=True, size="xl"
        )
        self.confirm = primitives.Field(
            kind="text", placeholder="再次输入", password=True, size="xl"
        )
        self.grid.add(forms.FormRow("新密码", self.password), key="password")
        self.grid.add(forms.FormRow("再次输入", self.confirm), key="confirm")

        self.password.returnPressed.connect(self.confirm.setFocus)
        self.confirm.returnPressed.connect(self.submit)
        self._initial_focus = self.password

    def form_error(self) -> str:
        password = self.password.text()
        error = validation.password_error(password)
        if error:
            return error
        return validation.password_confirm_error(password, self.confirm.text())

    def form_value(self):
        return self.password.text()
