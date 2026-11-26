"""Field：文本 / 选择 / 只读字段，以及内部省略标签。"""

from __future__ import annotations

from PySide6.QtCore import QEvent, QPoint, Qt, Signal
from PySide6.QtGui import QFontMetrics, QPalette
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMenu,
    QPushButton,
    QSizePolicy,
    QWidget,
)

from .. import palette, tokens
from ._paint import _qss


# ---------------------------------------------------------------------------
# Field
# ---------------------------------------------------------------------------


class Field(QFrame):
    """输入框 / 只读框 / 下拉选择，外观统一为胶囊底座。

    ``text`` 与 ``readonly`` 内部是真正的 ``QLineEdit``（只读时
    ``setReadOnly(True)``，仍可选中复制）；``select`` 用 QPushButton + QMenu，
    暴露 ``value()`` / ``setValue()`` / ``changed``。
    """

    KINDS = ("text", "select", "readonly")
    changed = Signal(str)
    returnPressed = Signal()

    def __init__(
        self,
        kind: str = "text",
        text: str = "",
        placeholder: str = "",
        options: list[tuple[str, str]] | None = None,
        password: bool = False,
        size: str | int = "xl",
        parent: QWidget | None = None,
    ) -> None:
        if kind not in self.KINDS:
            raise ValueError(f"未知 Field kind：{kind!r}")
        super().__init__(parent)
        self.kind = kind
        self._size = tokens.resolve_size(size)
        self._focused = False
        self._hovered = False
        self._style = ""
        self.setObjectName("cdguiField")
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setFixedHeight(self._size)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.setFont(tokens.font(13))

        layout = QHBoxLayout(self)
        layout.setContentsMargins(tokens.space(12), 0, tokens.space(12), 0)
        layout.setSpacing(0)

        self.edit: QLineEdit | None = None
        self.combo: QPushButton | None = None
        self._options: list[tuple[str, str]] = []
        self._labels: dict[str, str] = {}
        self._value = ""

        if kind == "select":
            self._options = list(options or [])
            self._labels = {value: label for value, label in self._options}
            self._value = self._options[0][0] if self._options else ""
            self.combo = QPushButton(self)
            self.combo.setCursor(Qt.CursorShape.PointingHandCursor)
            self.combo.setFlat(True)
            self.combo.setFont(tokens.font(13))
            self.combo.clicked.connect(self._show_menu)
            self.combo.installEventFilter(self)
            layout.addWidget(self.combo, 1)
            self._refresh_combo_text()
        else:
            self.edit = QLineEdit(self)
            self.edit.setFrame(False)
            self.edit.setFont(tokens.font(13))
            self.edit.setStyleSheet(
                "QLineEdit { background: transparent; border: none; padding: 0; }"
            )
            self.edit.setPlaceholderText(placeholder)
            if password:
                self.edit.setEchoMode(QLineEdit.EchoMode.Password)
            self.edit.setText(text)
            self.edit.setReadOnly(kind == "readonly")
            self.edit.installEventFilter(self)
            layout.addWidget(self.edit, 1)
            self.edit.returnPressed.connect(self.returnPressed)

        self._sync_style()
        self._apply_palette()

    # -- 主题 / 状态 -------------------------------------------------------

    def changeEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if event.type() in (
            QEvent.Type.PaletteChange,
            QEvent.Type.ApplicationPaletteChange,
        ):
            self._apply_palette()
            self._sync_style()
        super().changeEvent(event)

    def _apply_palette(self) -> None:
        if self.edit is None:
            return
        value = self.edit.palette()
        value.setColor(QPalette.ColorRole.Text, palette.color("text"))
        value.setColor(QPalette.ColorRole.PlaceholderText, palette.color("muted"))
        value.setColor(QPalette.ColorRole.Highlight, palette.color("primary"))
        value.setColor(QPalette.ColorRole.HighlightedText, palette.on_accent())
        self.edit.setPalette(value)

    def _sync_style(self) -> None:
        focused = self._focused
        if focused:
            border = palette.color("primary")
            background = palette.color("card")
        elif self._hovered and self.isEnabled():
            border = palette.color("border_strong")
            background = palette.color("card_alt")
        else:
            border = palette.color("border")
            background = palette.color("card_alt")
        style = (
            "QFrame#cdguiField {"
            f" background: {_qss(background)};"
            f" border: 1px solid {_qss(border)};"
            f" border-radius: {self._size // 2}px;"
            " }"
        )
        if style != self._style:
            self._style = style
            self.setStyleSheet(style)
        if self.combo is not None:
            combo_style = (
                "QPushButton {"
                " background: transparent;"
                " border: none;"
                " padding: 0;"
                f" color: {_qss(palette.color('text'))};"
                " text-align: left;"
                " }"
            )
            if self.combo.styleSheet() != combo_style:
                self.combo.setStyleSheet(combo_style)

    def eventFilter(self, watched, event) -> bool:  # noqa: N802 - Qt 命名
        if watched in (self.edit, self.combo):
            if event.type() == QEvent.Type.FocusIn:
                self._focused = True
                self._sync_style()
            elif event.type() == QEvent.Type.FocusOut:
                self._focused = False
                self._sync_style()
            elif (
                watched is self.combo
                and event.type() == QEvent.Type.KeyPress
                and event.key() in (Qt.Key.Key_Up, Qt.Key.Key_Down)
            ):
                self._show_menu()
                return True
        return super().eventFilter(watched, event)

    def enterEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self._hovered = True
        self._sync_style()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self._hovered = False
        self._sync_style()
        super().leaveEvent(event)

    # -- 通用接口 ---------------------------------------------------------

    def text(self) -> str:
        if self.kind == "select":
            return self._labels.get(self._value, self._value)
        return self.edit.text() if self.edit is not None else ""

    def setText(self, value: str) -> None:  # noqa: N802 - Qt 命名
        if self.kind == "select":
            if value in self._labels:
                self.setValue(value)
            else:
                for key, label in self._labels.items():
                    if label == value:
                        self.setValue(key)
                        break
            return
        if self.edit is not None:
            self.edit.setText(value)

    def setPlaceholderText(self, value: str) -> None:  # noqa: N802 - Qt 命名
        if self.edit is not None:
            self.edit.setPlaceholderText(value)

    def setEchoMode(self, mode) -> None:  # noqa: N802 - Qt 命名
        if self.edit is not None:
            self.edit.setEchoMode(mode)

    def setFocus(self) -> None:  # noqa: N802 - Qt 命名
        target = self.combo if self.kind == "select" else self.edit
        if target is not None:
            target.setFocus()

    # -- 只读 /  disabled --------------------------------------------------

    def set_form_mode(self, mode: str) -> None:
        if mode not in ("edit", "readonly", "disabled"):
            raise ValueError(f"未知表单模式：{mode!r}")
        if self.kind == "select":
            self.setEnabled(mode != "disabled")
            if self.combo is not None:
                self.combo.setEnabled(mode == "edit")
            self.setCursor(
                Qt.CursorShape.PointingHandCursor
                if mode == "edit"
                else Qt.CursorShape.ArrowCursor
            )
            self._sync_style()
            return
        if self.edit is not None:
            self.edit.setReadOnly(mode != "edit")
        self.setEnabled(mode != "disabled")
        self._sync_style()

    # -- 选择控件 ---------------------------------------------------------

    def value(self) -> str:
        return self._value if self.kind == "select" else self.text()

    def label(self) -> str:
        return self._labels.get(self._value, self._value)

    def setValue(self, value: str) -> None:  # noqa: N802 - Qt 命名
        if self.kind != "select":
            self.setText(value)
            return
        if value not in self._labels:
            return
        if value == self._value:
            return
        self._value = value
        self._refresh_combo_text()
        self.changed.emit(value)

    def options(self) -> list[tuple[str, str]]:
        return list(self._options)

    def _refresh_combo_text(self) -> None:
        if self.combo is not None:
            self.combo.setText(f"{self.label()}   ▾")
            self.combo.setAccessibleName(self.label())

    def _show_menu(self) -> None:
        if self.combo is None or not self.combo.isEnabled():
            return
        menu = QMenu(self)
        menu.setFont(tokens.font(13))
        for value, label in self._options:
            action = menu.addAction(label)
            action.setCheckable(True)
            action.setChecked(value == self._value)
            action.triggered.connect(
                lambda _checked=False, value=value: self.setValue(value)
            )
        menu.setMinimumWidth(self.width())
        menu.exec(self.mapToGlobal(QPoint(0, self.height() + tokens.space(4))))
        menu.deleteLater()

    def keyPressEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if self.kind == "select" and self.combo is not None:
            if event.key() in (Qt.Key.Key_Up, Qt.Key.Key_Down):
                self._show_menu()
                return
        super().keyPressEvent(event)


class _ElidedLabel(QLabel):
    """超长内容中间省略，完整内容放 tooltip。"""

    def __init__(
        self,
        text: str = "",
        size: int = 11,
        weight: int = 400,
        color: str = "muted",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._full = ""
        self.setFont(tokens.font(size, weight))
        self.setProperty("tone", color)
        self.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred)
        self.setText(text)

    def setText(self, text: str) -> None:  # noqa: N802 - Qt 命名
        self._full = text or ""
        self.setToolTip(self._full)
        self._refresh()

    def full_text(self) -> str:
        return self._full

    def _refresh(self) -> None:
        metrics = QFontMetrics(self.font())
        width = self.width() - 2
        if width <= 0:
            super().setText(self._full)
            return
        super().setText(
            metrics.elidedText(
                self._full, Qt.TextElideMode.ElideMiddle, width
            )
        )

    def resizeEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        super().resizeEvent(event)
        self._refresh()
