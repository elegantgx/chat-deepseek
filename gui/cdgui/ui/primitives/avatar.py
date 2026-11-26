"""Avatar：首字母圆形头像。"""

from __future__ import annotations

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QPainter
from PySide6.QtWidgets import QWidget

from .. import palette, tokens


# ---------------------------------------------------------------------------
# Avatar
# ---------------------------------------------------------------------------


class Avatar(QWidget):
    """账户头像：首字母圆形底色；选中变实心主色。"""

    def __init__(
        self,
        username: str = "",
        disabled: bool = False,
        size: str | int = "sm",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._username = username
        self._initial = (username[:1] or "?").upper()
        self._disabled = disabled
        self._selected = False
        self._size = tokens.resolve_size(size)
        self.setFixedSize(self._size, self._size)
        self.setFont(self._font())
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)

    def _font(self):
        if self._size <= tokens.height(32):
            size = 11
        elif self._size <= tokens.height(36):
            size = 13
        else:
            size = 15
        return tokens.font(size, 600)

    def username(self) -> str:
        return self._username

    def set_username(self, username: str) -> None:
        self._username = username
        self._initial = (username[:1] or "?").upper()
        self.update()

    def set_disabled(self, disabled: bool) -> None:
        self._disabled = disabled
        self.update()

    def set_selected(self, selected: bool) -> None:
        if selected != self._selected:
            self._selected = selected
            self.update()

    def is_selected(self) -> bool:
        return self._selected

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        if self._selected:
            background = palette.color("primary")
            foreground = palette.on_accent()
        elif self._disabled:
            background = palette.color("muted_soft")
            foreground = palette.color("muted")
        else:
            background = palette.color("primary_soft")
            foreground = palette.color("primary")
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(background)
        painter.drawEllipse(QRectF(self.rect()))
        painter.setPen(foreground)
        painter.setFont(self.font())
        painter.drawText(
            self.rect(), Qt.AlignmentFlag.AlignCenter, self._initial
        )
        painter.end()
