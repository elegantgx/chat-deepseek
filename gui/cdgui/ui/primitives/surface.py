"""Surface 与 SectionHeading：卡片/面板容器和标题行。"""

from __future__ import annotations

from PySide6.QtCore import QEvent, Qt
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout, QWidget

from .. import palette, tokens
from ._paint import _qss


# ---------------------------------------------------------------------------
# Surface
# ---------------------------------------------------------------------------


class Surface(QFrame):
    """圆角容器：``card`` 是带投影的白色卡片，``panel`` 是浅色面板。"""

    KINDS = ("card", "panel")

    def __init__(self, kind: str = "card", parent: QWidget | None = None) -> None:
        if kind not in self.KINDS:
            raise ValueError(f"未知 Surface kind：{kind!r}")
        super().__init__(parent)
        self.kind = kind
        self.setObjectName("cdguiSurface")
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        self.body = QVBoxLayout(self)
        if kind == "card":
            self.body.setContentsMargins(
                tokens.space(20), tokens.space(16), tokens.space(20), tokens.space(16)
            )
            self.body.setSpacing(tokens.space(12))
            self._shadow = palette.shadow(self, blur=30, dy=8, alpha=70)
        else:
            self.body.setContentsMargins(
                tokens.space(16), tokens.space(12), tokens.space(16), tokens.space(12)
            )
            self.body.setSpacing(tokens.space(8))
            self._shadow = None

        self._style = ""
        self._sync_style()

    def changeEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if event.type() in (
            QEvent.Type.PaletteChange,
            QEvent.Type.ApplicationPaletteChange,
        ):
            self._sync_style()
            self._sync_shadow()
        super().changeEvent(event)

    def _sync_style(self) -> None:
        if self.kind == "card":
            background = palette.color("card")
            border = palette.color("border")
            radius = tokens.radius(32)
        else:
            background = palette.color("card_alt")
            border = palette.color("border")
            radius = tokens.radius(18)
        style = (
            "QFrame#cdguiSurface {"
            f" background: {_qss(background)};"
            f" border: 1px solid {_qss(border)};"
            f" border-radius: {radius}px;"
            " }"
        )
        if style != self._style:
            self._style = style
            self.setStyleSheet(style)

    def _sync_shadow(self) -> None:
        if self._shadow is None:
            return
        self._shadow.setColor(palette.shadow_color())


# ---------------------------------------------------------------------------
# SectionHeading
# ---------------------------------------------------------------------------


class SectionHeading(QWidget):
    """页面 / 卡片标题，尾部可以继续挂控件。"""

    def __init__(self, text: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.row = QHBoxLayout(self)
        self.row.setContentsMargins(0, 0, 0, 0)
        self.row.setSpacing(tokens.space(8))
        self.label = QLabel(text, self)
        self.label.setFont(tokens.font(15, 600))
        self.row.addWidget(self.label)
        self.row.addStretch(1)

    def text(self) -> str:
        return self.label.text()

    def setText(self, text: str) -> None:  # noqa: N802 - Qt 命名
        self.label.setText(text)

    def add(self, widget: QWidget, stretch: int = 0) -> None:
        """把数量 chip、刷新按钮等挂到标题行尾部。"""
        self.row.addWidget(widget, stretch)
