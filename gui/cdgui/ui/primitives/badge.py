"""Badge：状态胶囊与组标签。"""

from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, QSize, Qt
from PySide6.QtGui import QFontMetrics, QPainter
from PySide6.QtWidgets import QSizePolicy, QWidget

from .. import palette, tokens
from ._paint import _capsule_path


# ---------------------------------------------------------------------------
# Badge
# ---------------------------------------------------------------------------


class Badge(QWidget):
    """状态 / 组标签：``soft`` 实底胶囊，``plain`` 只有文字（可带圆点）。"""

    KINDS = ("soft", "plain")
    HEIGHT = tokens.height(24)

    def __init__(
        self,
        text: str = "",
        tone: str = "muted",
        kind: str = "soft",
        dot: bool = True,
        parent: QWidget | None = None,
    ) -> None:
        if kind not in self.KINDS:
            raise ValueError(f"未知 Badge kind：{kind!r}")
        super().__init__(parent)
        self._text = text
        self._tone = palette.tone_name(tone)
        self._kind = kind
        self._dot = dot
        self.setFont(tokens.font(11, 600))
        self.setFixedHeight(self.HEIGHT)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)

    @classmethod
    def group(cls, group_name: str, parent: QWidget | None = None) -> "Badge":
        """按组角色创建标签，避免页面自己查映射。"""
        return cls(group_name, tone=palette.group_tone(group_name), parent=parent)

    def text(self) -> str:
        return self._text

    def setText(self, text: str) -> None:  # noqa: N802 - Qt 命名
        self._text = text
        self.updateGeometry()
        self.update()

    def tone(self) -> str:
        return self._tone

    def set_tone(self, tone: str) -> None:
        self._tone = palette.tone_name(tone)
        self.update()

    def set_state(self, text: str, tone: str) -> None:
        """兼容旧 StatusPill/StatusBadge 的调用方式。"""
        self.setText(text)
        self.set_tone(tone)

    def kind(self) -> str:
        return self._kind

    def set_kind(self, kind: str) -> None:
        if kind not in self.KINDS:
            raise ValueError(f"未知 Badge kind：{kind!r}")
        self._kind = kind
        self.updateGeometry()
        self.update()

    def set_dot(self, dot: bool) -> None:
        self._dot = dot
        self.updateGeometry()
        self.update()

    def sizeHint(self) -> QSize:  # noqa: N802 - Qt 命名
        metrics = QFontMetrics(self.font())
        dot_width = 10 if self._dot else 0
        padding = 20 if self._kind == "soft" else 0
        return QSize(
            metrics.horizontalAdvance(self._text) + dot_width + padding,
            self.HEIGHT,
        )

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        foreground, background = palette.tone(self._tone)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)

        if self._kind == "soft":
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(background)
            painter.drawPath(_capsule_path(rect))

        x = 10.0 if self._kind == "soft" else 0.0
        if self._dot:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(foreground)
            painter.drawEllipse(
                QPointF(x + 2.5, self.height() / 2), 2.5, 2.5
            )
            x += 10

        # plain 沿用旧 StatusBadge 的安静观感：只有 danger 用彩色文字，
        # 其余 tones 靠圆点表达状态。
        if self._kind == "plain" and self._tone != "danger":
            text_color = palette.color("muted")
        else:
            text_color = foreground
        painter.setPen(text_color)
        painter.setFont(self.font())
        painter.drawText(
            QRectF(x, 0, max(0.0, self.width() - x), self.height()),
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            self._text,
        )
        painter.end()
