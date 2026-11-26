"""ListRow：可选中、可聚焦的通用列表行。"""

from __future__ import annotations

from PySide6.QtCore import QRectF, Qt, Signal
from PySide6.QtGui import QPainter, QPen
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from .. import palette, tokens
from ._paint import _capsule_path
from .field import _ElidedLabel


class ListRow(QFrame):
    """通用列表行：可选中、可聚焦，↑/↓/空格/Enter 都有信号。

    账户行、备份行都据此特化；行本身不关心数据，``key`` 只用于让页面认领。
    """

    clicked = Signal()
    activated = Signal()
    toggled = Signal(bool)
    upPressed = Signal()
    downPressed = Signal()

    def __init__(
        self,
        title: str = "",
        subtitle: str = "",
        avatar: QWidget | None = None,
        trailing: QWidget | None = None,
        key: object | None = None,
        size: str | int = "xxl",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.key = key if key is not None else title
        self._selected = False
        self._hovered = False
        self._keyboard_focus = False
        self._height = tokens.resolve_size(size)
        self.setFixedHeight(self._height)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.setAccessibleName(f"{title}，{subtitle}" if subtitle else title)

        row = QHBoxLayout(self)
        row.setContentsMargins(
            tokens.space(20), 0, tokens.space(20), 0
        )
        row.setSpacing(tokens.space(12))

        self.avatar = avatar
        if avatar is not None:
            row.addWidget(avatar, 0, Qt.AlignmentFlag.AlignVCenter)

        self.column = QVBoxLayout()
        self.column.setContentsMargins(0, 0, 0, 0)
        self.column.setSpacing(2)
        self.title = QLabel(title, self)
        self.title.setFont(tokens.font(13, 600))
        self.title.setSizePolicy(
            QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred
        )
        self.title.setToolTip(title)
        self.column.addWidget(self.title)
        self.subtitle = _ElidedLabel(subtitle, 11, 400, "muted", self)
        self.subtitle.setVisible(bool(subtitle))
        self.column.addWidget(self.subtitle)
        self.column.addStretch(1)
        row.addLayout(self.column, 1)

        self.trailing = trailing
        if trailing is not None:
            row.addWidget(trailing, 0, Qt.AlignmentFlag.AlignVCenter)

        for child in (avatar, self.title, self.subtitle):
            if child is not None:
                child.setAttribute(
                    Qt.WidgetAttribute.WA_TransparentForMouseEvents, True
                )

    def set_title(self, title: str) -> None:
        self.title.setText(title)
        self.title.setToolTip(title)
        self._refresh_accessibility()

    def set_subtitle(self, subtitle: str) -> None:
        self.subtitle.setText(subtitle)
        self.subtitle.setVisible(bool(subtitle))
        self._refresh_accessibility()

    def _refresh_accessibility(self) -> None:
        title = self.title.text()
        subtitle = self.subtitle.full_text()
        self.setAccessibleName(f"{title}，{subtitle}" if subtitle else title)

    def is_selected(self) -> bool:
        return self._selected

    def set_selected(self, selected: bool) -> None:
        if selected == self._selected:
            return
        self._selected = selected
        if self.avatar is not None and hasattr(self.avatar, "set_selected"):
            self.avatar.set_selected(selected)
        self.update()

    def enterEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self._hovered = True
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self._hovered = False
        self.update()
        super().leaveEvent(event)

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

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mouseReleaseEvent(event)

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if event.button() == Qt.MouseButton.LeftButton:
            self.activated.emit()
        super().mouseDoubleClickEvent(event)

    def keyPressEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        key = event.key()
        if key == Qt.Key.Key_Up:
            self.upPressed.emit()
        elif key == Qt.Key.Key_Down:
            self.downPressed.emit()
        elif key == Qt.Key.Key_Space:
            self.set_selected(not self._selected)
            self.toggled.emit(self._selected)
        elif key in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            self.activated.emit()
        else:
            super().keyPressEvent(event)
            return
        event.accept()

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        if self._selected or self._hovered:
            body = QRectF(self.rect()).adjusted(4, 0, -5, 0)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(
                palette.color("selected" if self._selected else "card_alt")
            )
            painter.drawPath(_capsule_path(body))
            if self._selected:
                painter.setPen(QPen(palette.rgba("primary", 62), 1))
                painter.setBrush(Qt.BrushStyle.NoBrush)
                painter.drawPath(_capsule_path(body))
        else:
            painter.setPen(QPen(palette.color("border"), 1))
            painter.drawLine(
                tokens.space(20),
                self._height - 1,
                self.width() - tokens.space(20),
                self._height - 1,
            )
        if self.hasFocus() and self._keyboard_focus:
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.setPen(QPen(palette.rgba("primary", 140), 1.2))
            painter.drawPath(
                _capsule_path(QRectF(self.rect()).adjusted(2, 2, -3, -2))
            )
        painter.end()
