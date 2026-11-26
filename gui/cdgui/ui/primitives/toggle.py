"""Switch、SwitchRow 与 Choice：开关、开关行和勾选/单选项。"""

from __future__ import annotations

from PySide6.QtCore import (
    Property,
    QEasingCurve,
    QPointF,
    QPropertyAnimation,
    QRectF,
    QSize,
    Qt,
)
from PySide6.QtGui import QFontMetrics, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (
    QAbstractButton,
    QHBoxLayout,
    QLabel,
    QSizePolicy,
    QWidget,
)

from .. import palette, tokens
from ._paint import _capsule_path, _rounded_path


# ---------------------------------------------------------------------------
# Switch / SwitchRow
# ---------------------------------------------------------------------------


class Switch(QAbstractButton):
    """官方风格胶囊开关：滑块带短促缓动。"""

    WIDTH = 42
    HEIGHT = tokens.height(24)
    THUMB = 18

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setCheckable(True)
        self.setFixedSize(self.WIDTH, self.HEIGHT)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self._offset = 0.0
        self._hovered = False
        self._keyboard_focus = False
        self._animation = QPropertyAnimation(self, b"offset", self)
        self._animation.setDuration(150)
        self._animation.setEasingCurve(QEasingCurve.Type.OutCubic)
        self.toggled.connect(self._animate)

    def _get_offset(self) -> float:
        return self._offset

    def _set_offset(self, value: float) -> None:
        self._offset = value
        self.update()

    offset = Property(float, _get_offset, _set_offset)

    def setChecked(self, checked: bool) -> None:  # noqa: N802 - Qt 命名
        super().setChecked(checked)
        self._offset = 1.0 if checked else 0.0
        self.update()

    def _animate(self, checked: bool) -> None:
        self._animation.stop()
        self._animation.setStartValue(self._offset)
        self._animation.setEndValue(1.0 if checked else 0.0)
        self._animation.start()

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

    def sizeHint(self) -> QSize:  # noqa: N802 - Qt 命名
        return QSize(self.WIDTH, self.HEIGHT)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        if not self.isEnabled():
            track = palette.color("muted_soft")
        elif self.isChecked():
            track = palette.color(
                "primary_hover" if self._hovered else "primary"
            )
        else:
            track = palette.color(
                "switch_off_hover" if self._hovered else "switch_off"
            )

        track_rect = QRectF(0, 0, self.WIDTH, self.HEIGHT)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(track)
        painter.drawPath(_capsule_path(track_rect))

        if self.hasFocus() and self._keyboard_focus:
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.setPen(QPen(palette.rgba("primary", 150), 1.2))
            painter.drawPath(_capsule_path(track_rect.adjusted(1, 1, -1, -1)))

        x = 3 + self._offset * (self.WIDTH - self.THUMB - 6)
        y = (self.HEIGHT - self.THUMB) / 2
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(palette.color("shadow"))
        painter.drawEllipse(QRectF(x, y + 1, self.THUMB, self.THUMB))
        painter.setBrush(palette.on_accent())
        painter.setPen(QPen(palette.rgba("border_strong", 120), 1))
        painter.drawEllipse(QRectF(x, y, self.THUMB, self.THUMB))
        painter.end()


class SwitchRow(QWidget):
    """开关 + 可点击文字。"""

    def __init__(
        self,
        text: str = "",
        checked: bool = True,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))
        self.switch = Switch(self)
        self.switch.setChecked(checked)
        self.label = QLabel(text, self)
        self.label.setFont(tokens.font(12))
        self.label.setProperty("tone", "muted")
        self.label.setCursor(Qt.CursorShape.PointingHandCursor)
        self.label.mouseReleaseEvent = lambda _event: self.switch.toggle()  # type: ignore[method-assign]
        row.addWidget(self.label)
        row.addWidget(self.switch)
        row.addStretch(1)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)

    def isChecked(self) -> bool:  # noqa: N802 - Qt 命名
        return self.switch.isChecked()

    def setChecked(self, checked: bool) -> None:  # noqa: N802 - Qt 命名
        self.switch.setChecked(checked)

    @property
    def toggled(self):
        return self.switch.toggled

    def text(self) -> str:
        return self.label.text()

    def setText(self, text: str) -> None:  # noqa: N802 - Qt 命名
        self.label.setText(text)


# ---------------------------------------------------------------------------
# Choice
# ---------------------------------------------------------------------------


class Choice(QAbstractButton):
    """勾选 / 单选项：``check`` 为方形复选框，``row`` 为整行圆点选项。"""

    KINDS = ("check", "row")

    def __init__(
        self,
        text: str = "",
        kind: str = "check",
        checked: bool = False,
        parent: QWidget | None = None,
    ) -> None:
        if kind not in self.KINDS:
            raise ValueError(f"未知 Choice kind：{kind!r}")
        super().__init__(parent)
        self.kind = kind
        self._height = tokens.height(24 if kind == "check" else 40)
        self.setText(text)
        self.setCheckable(True)
        self.setChecked(checked)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFont(
            tokens.font(12 if kind == "check" else 13, 500 if kind == "check" else 400)
        )
        self.setFixedHeight(self._height)
        policy = (
            QSizePolicy.Policy.Fixed
            if kind == "check"
            else QSizePolicy.Policy.Expanding
        )
        self.setSizePolicy(policy, QSizePolicy.Policy.Fixed)

    def enterEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self.update()
        super().leaveEvent(event)

    def sizeHint(self) -> QSize:  # noqa: N802 - Qt 命名
        metrics = QFontMetrics(self.font())
        left = 26 if self.kind == "check" else 36
        return QSize(metrics.horizontalAdvance(self.text()) + left + 12, self._height)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        checked = self.isChecked()

        if self.kind == "check":
            box = QRectF(0.5, (self._height - 17) / 2, 17, 17)
            if checked:
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(palette.color("primary"))
                painter.drawPath(_rounded_path(box, tokens.radius(8)))
                path = QPainterPath()
                path.moveTo(4.5, 12.0)
                path.lineTo(8.0, 15.0)
                path.lineTo(13.8, 8.4)
                painter.setPen(
                    QPen(
                        palette.on_accent(),
                        2.0,
                        Qt.PenStyle.SolidLine,
                        Qt.PenCapStyle.RoundCap,
                        Qt.PenJoinStyle.RoundJoin,
                    )
                )
                painter.drawPath(path)
            else:
                painter.setPen(QPen(palette.color("border_strong"), 1.2))
                painter.setBrush(palette.color("card_alt"))
                painter.drawPath(_rounded_path(box, tokens.radius(8)))
            painter.setPen(palette.color("text"))
            painter.setFont(self.font())
            painter.drawText(
                QRectF(26, 0, max(0, self.width() - 26), self._height),
                Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                self.text(),
            )
            painter.end()
            return

        rect = QRectF(self.rect()).adjusted(1, 1, -1, -1)
        if checked:
            painter.setBrush(palette.color("primary_soft"))
            painter.setPen(QPen(palette.color("primary"), 1.2))
        elif self.underMouse():
            painter.setBrush(palette.color("card_alt"))
            painter.setPen(QPen(palette.color("border"), 1))
        else:
            painter.setBrush(palette.color("card"))
            painter.setPen(QPen(palette.color("border"), 1))
        painter.drawPath(_rounded_path(rect, tokens.radius(18)))

        center = QPointF(19, self._height / 2)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.setPen(
            QPen(
                palette.color(
                    "primary" if checked else "border_strong"
                ),
                1.6,
            )
        )
        painter.drawEllipse(center, 7, 7)
        if checked:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(palette.color("primary"))
            painter.drawEllipse(center, 3.6, 3.6)

        painter.setPen(palette.color("text"))
        painter.setFont(self.font())
        painter.drawText(
            QRectF(36, 0, max(0, self.width() - 48), self._height),
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            self.text(),
        )
        painter.end()
