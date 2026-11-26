"""登录 sheet：只做取值、就地显示错误、回车提交。

不直接调用 controller，也不重复 controller 的校验：窗口连接 ``submitted``
信号后调用 ``controller.login``，错误通过 ``state.login.error`` 回到同一个
sheet。关闭后不自动重试由 MainWindow 负责。
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)

from ..domain import validation
from . import tokens
from .forms import FormGrid, FormRow
from .primitives import Button, Field

DESCRIPTION = (
    "使用 Admin 或 Owner 账户登录。"
    "登录只在本窗口有效，15 分钟后自动退出。"
)


class LoginSheet(QDialog):
    """登录表单；``submitted(username, password)`` 交给窗口转给 controller。"""

    submitted = Signal(str, str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("登录")
        self.setObjectName("sheet")
        self.setModal(True)
        self.setWindowFlag(Qt.WindowType.WindowContextHelpButtonHint, False)
        self.setMinimumWidth(420)

        root = QVBoxLayout(self)
        root.setContentsMargins(
            tokens.space(24), tokens.space(20), tokens.space(24), tokens.space(20)
        )
        root.setSpacing(tokens.space(16))

        self.heading = QLabel("登录", self)
        self.heading.setFont(tokens.font(15, 600))
        root.addWidget(self.heading)

        self.description = QLabel(DESCRIPTION, self)
        self.description.setFont(tokens.font(12))
        self.description.setProperty("tone", "muted")
        self.description.setWordWrap(True)
        root.addWidget(self.description)

        self.form = FormGrid(self)
        self.username_field = Field(kind="text", size="xl")
        self.username_field.setPlaceholderText("用户名")
        self.password_field = Field(kind="text", password=True, size="xl")
        self.password_field.setPlaceholderText("密码")
        self.form.add(FormRow("用户名", self.username_field, parent=self), key="username")
        self.form.add(FormRow("密码", self.password_field, parent=self), key="password")
        root.addWidget(self.form)

        self.error_label = QLabel("", self)
        self.error_label.setFont(tokens.font(12))
        self.error_label.setProperty("tone", "danger")
        self.error_label.setWordWrap(True)
        self.error_label.hide()
        root.addWidget(self.error_label)

        actions = QHBoxLayout()
        actions.setContentsMargins(0, tokens.space(4), 0, 0)
        actions.setSpacing(tokens.space(8))
        actions.addStretch(1)
        self.cancel_button = Button("取消", kind="secondary", size="lg", parent=self)
        self.login_button = Button("登录", kind="primary", size="lg", parent=self)
        actions.addWidget(self.cancel_button)
        actions.addWidget(self.login_button)
        root.addLayout(actions)

        self.cancel_button.clicked.connect(self.reject)
        self.login_button.clicked.connect(self.submit)
        self.login_button.setDefault(True)
        self.username_field.returnPressed.connect(self.submit)
        self.password_field.returnPressed.connect(self.submit)

    # -- 数据与错误 --------------------------------------------------------

    def username(self) -> str:
        return self.username_field.text().strip()

    def password(self) -> str:
        return self.password_field.text()

    def set_username(self, username: str) -> None:
        self.username_field.setText(username or "")

    def set_error(self, message: str) -> None:
        self.error_label.setText(message or "")
        self.error_label.setVisible(bool(message))

    def error_text(self) -> str:
        return self.error_label.text()

    def submit(self) -> None:
        username = self.username()
        password = self.password()
        if not username:
            self.set_error("请输入用户名")
            self.username_field.setFocus()
            return
        error = validation.login_password_error(password)
        if error:
            self.set_error(error)
            self.password_field.setFocus()
            return
        self.set_error("")
        self.submitted.emit(username, password)

    # -- 焦点 --------------------------------------------------------------

    def showEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        super().showEvent(event)
        if self.username():
            self.password_field.setFocus()
        else:
            self.username_field.setFocus()


__all__ = ["DESCRIPTION", "LoginSheet"]
