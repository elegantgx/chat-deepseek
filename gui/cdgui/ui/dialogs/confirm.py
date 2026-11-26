"""确认对话框：默认焦点在“取消”，危险操作确认按钮用 danger 样式。"""

from __future__ import annotations

from PySide6.QtWidgets import QLabel, QWidget

from .. import tokens
from .base import SheetDialog


class ConfirmDialog(SheetDialog):
    """是/否确认；接受时 ``value`` 为 ``True``，取消或关闭为 ``None``。"""

    def __init__(
        self,
        parent: QWidget | None,
        title: str,
        message: str,
        danger: bool = False,
    ) -> None:
        super().__init__(
            parent, title, "", width=440, body_max_height=200
        )
        text = QLabel(message, self)
        text.setObjectName("cdguiConfirmMessage")
        text.setFont(tokens.font(13))
        text.setWordWrap(True)
        self.message_label = text
        self.add(text)

        # 默认焦点必须落在“取消”，避免误按 Enter 执行危险操作。
        self.buttons(
            "确定",
            self._ok,
            cancel="取消",
            danger=bool(danger),
            default="cancel",
        )
        self._initial_focus = self.cancel_button

    def _ok(self) -> None:
        self.value = True
        self.accept()


def ask_confirm(
    parent: QWidget | None,
    title: str,
    message: str,
    danger: bool = False,
) -> bool:
    """模态确认，返回用户是否点了确认。"""
    dialog = ConfirmDialog(parent, title, message, danger=danger)
    dialog.exec_modal()
    return dialog.value is True
