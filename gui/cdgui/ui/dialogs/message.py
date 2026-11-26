"""消息对话框：说明文字 + 可选等宽只读详情，底部“关闭”默认按钮。"""

from __future__ import annotations

from PySide6.QtGui import QFontDatabase
from PySide6.QtWidgets import QLabel, QPlainTextEdit, QWidget

from .. import tokens
from .base import SheetDialog


class MessageDialog(SheetDialog):
    """展示提示或错误详情；没有返回值。"""

    def __init__(
        self,
        parent: QWidget | None,
        title: str,
        message: str,
        details: str | None = None,
    ) -> None:
        super().__init__(
            parent,
            title,
            "",
            width=560 if details else 460,
            body_max_height=400 if details else 240,
        )
        self.message_label = QLabel(message, self)
        self.message_label.setObjectName("cdguiMessageText")
        self.message_label.setFont(tokens.font(13))
        self.message_label.setWordWrap(True)
        self.add(self.message_label)

        self.details_edit: QPlainTextEdit | None = None
        if details:
            self.details_edit = QPlainTextEdit(self._content)
            self.details_edit.setObjectName("cdguiMessageDetails")
            self.details_edit.setReadOnly(True)
            self.details_edit.setPlainText(details)
            self.details_edit.setLineWrapMode(
                QPlainTextEdit.LineWrapMode.NoWrap
            )
            self.details_edit.setMinimumHeight(tokens.height(60) * 3)
            self.details_edit.setFont(
                QFontDatabase.systemFont(QFontDatabase.SystemFont.FixedFont)
            )
            self.add(self.details_edit, 1)

        self.close_button = self.add_button(
            "关闭", kind="secondary", default=True, on_click=self.accept
        )
        self._initial_focus = self.close_button

    @property
    def details(self) -> str:
        return self.details_edit.toPlainText() if self.details_edit else ""


def show_message(
    parent: QWidget | None,
    title: str,
    message: str,
    details: str | None = None,
) -> None:
    """模态展示一条消息；调用方不需要处理返回值。"""
    dialog = MessageDialog(parent, title, message, details)
    dialog.exec_modal()
