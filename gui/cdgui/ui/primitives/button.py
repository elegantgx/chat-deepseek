"""Button 与 button() 工厂。"""

from __future__ import annotations

from PySide6.QtCore import QRectF, QSize, Qt
from PySide6.QtGui import QColor, QFontMetrics, QPainter, QPen
from PySide6.QtWidgets import QPushButton, QSizePolicy, QWidget

from .. import palette, tokens
from ._paint import _capsule_path


# ---------------------------------------------------------------------------
# Button
# ---------------------------------------------------------------------------


class Button(QPushButton):
    """胶囊按钮：primary / secondary / ghost / danger，尺寸只收 size。"""

    KINDS = ("primary", "secondary", "ghost", "danger")

    def __init__(
        self,
        text: str = "",
        kind: str = "secondary",
        size: str | int = "lg",
        parent: QWidget | None = None,
    ) -> None:
        if kind not in self.KINDS:
            raise ValueError(f"未知 Button kind：{kind!r}")
        super().__init__(text, parent)
        self.kind = kind
        self._size = tokens.resolve_size(size)
        self._keyboard_focus = False
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setAttribute(Qt.WidgetAttribute.WA_Hover, True)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
        self._apply_size()

    def _apply_size(self) -> None:
        self.setFixedHeight(self._size)
        large = self._size >= tokens.height(36)
        self.setFont(
            tokens.font(
                13 if large else 12,
                600 if self.kind == "primary" else 500,
            )
        )
        self.updateGeometry()
        self.update()

    def set_size(self, size: str | int) -> None:
        self._size = tokens.resolve_size(size)
        self._apply_size()

    def size(self) -> int:
        return self._size

    def sizeHint(self) -> QSize:  # noqa: N802 - Qt 命名
        metrics = QFontMetrics(self.font())
        padding = 24 if self._size <= tokens.height(32) else 34
        return QSize(metrics.horizontalAdvance(self.text()) + padding, self._size)

    def focusInEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self._keyboard_focus = event.reason() in (
            Qt.FocusReason.TabFocusReason,
            Qt.FocusReason.BacktabFocusReason,
            Qt.FocusReason.ShortcutFocusReason,
        )
        self.update()
        super().focusInEvent(event)

    def focusOutEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self._keyboard_focus = False
        self.update()
        super().focusOutEvent(event)

    def enterEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self.update()
        super().leaveEvent(event)

    def _colors(self) -> tuple[QColor | None, QColor | None, QColor]:
        hovered = self.underMouse()
        pressed = self.isDown()
        if not self.isEnabled():
            if self.kind == "ghost":
                return None, None, palette.color("muted")
            return (
                palette.color("card_alt"),
                palette.color("border"),
                palette.color("muted"),
            )
        if self.kind == "primary":
            if pressed:
                fill = palette.color("primary_pressed")
            elif hovered:
                fill = palette.color("primary_hover")
            else:
                fill = palette.color("primary")
            return fill, None, palette.on_accent()
        if self.kind == "danger":
            fill = (
                palette.color("danger_soft")
                if hovered or pressed
                else palette.color("card")
            )
            return fill, palette.mix("danger", "card", 0.72), palette.color("danger")
        if self.kind == "ghost":
            fill = (
                palette.color("card_alt") if hovered or pressed else None
            )
            return fill, None, palette.color("text" if hovered else "muted")
        if pressed:
            fill = palette.color("muted_soft")
        elif hovered:
            fill = palette.color("card_alt")
        else:
            fill = palette.color("card")
        return fill, palette.color("border"), palette.color("text")

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        fill, border, text = self._colors()
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        painter.setBrush(fill if fill is not None else Qt.BrushStyle.NoBrush)
        if border is not None:
            painter.setPen(QPen(border, 1))
        else:
            painter.setPen(Qt.PenStyle.NoPen)
        painter.drawPath(_capsule_path(rect))

        if self.hasFocus() and self._keyboard_focus:
            if self.kind == "primary":
                ring = palette.on_accent()
                ring.setAlpha(110)
            elif self.kind == "danger":
                ring = palette.rgba("danger", 110)
            else:
                ring = palette.rgba("primary", 150)
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.setPen(QPen(ring, 1.2))
            painter.drawPath(_capsule_path(rect.adjusted(2, 2, -2, -2)))

        painter.setPen(text)
        painter.setFont(self.font())
        offset = 1 if self.isDown() else 0
        painter.drawText(
            rect.adjusted(0, offset, 0, offset),
            Qt.AlignmentFlag.AlignCenter,
            self.text(),
        )
        painter.end()


def button(
    text: str,
    kind: str = "secondary",
    parent: QWidget | None = None,
    size: str | int = "lg",
) -> Button:
    """按钮工厂，与 ``Button`` 参数一致，页面用起来更短。"""
    return Button(text, kind=kind, size=size, parent=parent)
