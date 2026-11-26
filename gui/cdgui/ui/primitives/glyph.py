"""品牌鲸鱼标志与登录锁图标。"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QPainter, QPen
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import QWidget

from .. import palette, tokens
from ._paint import _rounded_path

_GUI_DIR = Path(__file__).resolve().parents[3]
_DEFAULT_LOGO = _GUI_DIR / "assets" / "whale.svg"


# ---------------------------------------------------------------------------
# BrandLogo / LockGlyph
# ---------------------------------------------------------------------------


class BrandLogo(QWidget):
    """主色圆角底 + 白色鲸鱼标志（Simple Icons，CC0-1.0）。"""

    def __init__(
        self,
        svg_path: str | Path | None = None,
        size: str | int = "xl",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._size = tokens.resolve_size(size)
        self.setFixedSize(self._size, self._size)
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self._renderer = QSvgRenderer(str(svg_path or _DEFAULT_LOGO), self)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        size = float(self._size)
        radius = tokens.nearest_radius(size * 0.39)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(palette.color("primary"))
        painter.drawPath(
            _rounded_path(QRectF(0, 0, size, size), radius)
        )
        if self._renderer.isValid():
            inset = size * 0.17
            self._renderer.render(
                painter, QRectF(inset, inset, size - inset * 2, size - inset * 2)
            )
        painter.end()


class LockGlyph(QWidget):
    """登录锁定态的标志：主色锁体 + 柔和的圆角底。"""

    def __init__(
        self,
        size: str | int = "xl",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._size = tokens.resolve_size(size)
        self.setFixedSize(self._size, self._size)
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        size = float(self._size)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(palette.color("primary_soft"))
        painter.drawPath(
            _rounded_path(
                QRectF(0, 0, size, size), tokens.nearest_radius(size * 0.32)
            )
        )

        primary = palette.color("primary")
        painter.setBrush(primary)
        body = QRectF(size * 0.32, size * 0.46, size * 0.36, size * 0.31)
        painter.drawPath(_rounded_path(body, size * 0.09))

        pen = QPen(
            primary,
            max(1.5, size * 0.085),
            Qt.PenStyle.SolidLine,
            Qt.PenCapStyle.RoundCap,
        )
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        shackle = QRectF(size * 0.365, size * 0.265, size * 0.27, size * 0.30)
        painter.drawArc(shackle, 0, 180 * 16)

        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(palette.color("primary_soft"))
        painter.drawEllipse(
            QPointF(size * 0.5, size * 0.585), size * 0.035, size * 0.035
        )
        painter.drawRoundedRect(
            QRectF(size * 0.485, size * 0.60, size * 0.03, size * 0.10),
            size * 0.015,
            size * 0.015,
        )
        painter.end()
