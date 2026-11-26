"""Toast：窗口底部短提示，QSS 画胶囊 + 淡入淡出。"""

from __future__ import annotations

from PySide6.QtCore import QEvent, QPropertyAnimation, QTimer, Qt
from PySide6.QtGui import QFontMetrics
from PySide6.QtWidgets import QGraphicsOpacityEffect, QHBoxLayout, QLabel, QWidget

from .. import palette, tokens
from ._paint import _qss


# ---------------------------------------------------------------------------
# Toast
# ---------------------------------------------------------------------------


class Toast(QWidget):
    """窗口底部居中的短提示；QSS 画胶囊，只保留淡入淡出。"""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setObjectName("cdguiToast")
        self.setFont(tokens.font(12, 600))
        self._text = ""
        self._error = False
        self._style = ""
        self.label = QLabel("", self)
        self.label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.label.setFont(self.font())
        layout = QHBoxLayout(self)
        layout.setContentsMargins(
            tokens.space(20), 0, tokens.space(20), 0
        )
        layout.addWidget(self.label)

        self._opacity = QGraphicsOpacityEffect(self)
        self._opacity.setOpacity(0.0)
        self.setGraphicsEffect(self._opacity)
        self._fade = QPropertyAnimation(self._opacity, b"opacity", self)
        self._fade.setDuration(140)
        self._fade.finished.connect(self._after_fade)
        self._hide_timer = QTimer(self)
        self._hide_timer.setSingleShot(True)
        self._hide_timer.timeout.connect(self._fade_out)
        self._sync_style()
        self.hide()

    def text(self) -> str:
        return self._text

    def show_message(self, message: str, error: bool = False) -> None:
        self._text = message
        self._error = error
        self.label.setText(message)
        self._sync_style()
        metrics = QFontMetrics(self.font())
        self.setFixedSize(
            metrics.horizontalAdvance(message)
            + tokens.space(20) * 2
            + tokens.space(8),
            tokens.height(36),
        )
        self.reposition()
        self.show()
        self.raise_()
        self._fade.stop()
        self._fade.setStartValue(self._opacity.opacity())
        # 1.0 会让 QGraphicsOpacityEffect 走直通路径，QSS 背景在部分平台上
        # 反而不再绘制；停在 0.999 视觉上看不出差别。
        self._fade.setEndValue(0.999)
        self._fade.start()
        self._hide_timer.start(2600)

    def showMessage(self, message: str, error: bool = False) -> None:  # noqa: N802
        self.show_message(message, error=error)

    def reposition(self) -> None:
        parent = self.parentWidget()
        if parent is None:
            return
        x = (parent.width() - self.width()) // 2
        y = parent.height() - self.height() - tokens.space(20)
        self.move(max(x, tokens.space(12)), max(y, tokens.space(12)))

    def changeEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if event.type() in (
            QEvent.Type.PaletteChange,
            QEvent.Type.ApplicationPaletteChange,
        ):
            self._sync_style()
        super().changeEvent(event)

    def _sync_style(self) -> None:
        if self._error:
            foreground = palette.color("danger")
            background = palette.color("danger_soft")
        else:
            foreground = palette.color("success")
            background = palette.color("success_soft")
        style = (
            "#cdguiToast {"
            f" background: {_qss(background)};"
            f" border: 1px solid {_qss(foreground)};"
            f" border-radius: {tokens.height(36) // 2}px;"
            " }"
            f" QLabel {{ color: {_qss(foreground)}; background: transparent; }}"
        )
        if style != self._style:
            self._style = style
            self.setStyleSheet(style)

    def _fade_out(self) -> None:
        self._fade.stop()
        self._fade.setStartValue(self._opacity.opacity())
        self._fade.setEndValue(0.0)
        self._fade.start()

    def _after_fade(self) -> None:
        if self._opacity.opacity() <= 0.01:
            self.hide()
