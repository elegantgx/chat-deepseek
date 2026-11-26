"""表单原语：FormRow / FormGrid / PathRow / CopyRow / DangerRow。

标签列固定 112px；只读用 ``QLineEdit.setReadOnly(True)``，内容仍可选中复制；
只有真正不可用时才 disabled。隐藏行不占位，但仍保留在 ``values()`` 里
（需要只看可见行时传 ``visible_only=True``）。
"""

from __future__ import annotations

from collections.abc import Iterable

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from . import primitives, tokens

LABEL_WIDTH = 112
FORM_MODES = ("edit", "readonly", "disabled")


def _keys(keys: str | Iterable[str]) -> tuple[str, ...]:
    if isinstance(keys, str):
        return (keys,)
    return tuple(keys)


class FormRow(QWidget):
    """一行表单：112px 标签 + 控件 + 可选说明。"""

    def __init__(
        self,
        label: str,
        control: QWidget,
        hint: str = "",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.control = control
        self._mode = "edit"

        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(12))

        self.label = QLabel(label, self)
        self.label.setFont(tokens.font(12, 500))
        self.label.setProperty("tone", "muted")
        self.label.setFixedWidth(LABEL_WIDTH)
        self.label.setAlignment(
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter
        )
        row.addWidget(self.label, 0)

        self.body = QVBoxLayout()
        self.body.setContentsMargins(0, 0, 0, 0)
        self.body.setSpacing(tokens.space(4))
        self.body.addWidget(control)
        self.hint = QLabel(hint, self)
        self.hint.setFont(tokens.font(11))
        self.hint.setProperty("tone", "muted")
        self.hint.setWordWrap(True)
        self.hint.setVisible(bool(hint))
        self.body.addWidget(self.hint)
        row.addLayout(self.body, 1)

        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)

    def set_mode(self, mode: str) -> None:
        if mode not in FORM_MODES:
            raise ValueError(f"未知表单模式：{mode!r}")
        self._mode = mode
        self._apply_mode()

    def mode(self) -> str:
        return self._mode

    def _apply_mode(self) -> None:
        self.label.setEnabled(self._mode != "disabled")
        apply_mode = getattr(self.control, "set_form_mode", None)
        if callable(apply_mode):
            apply_mode(self._mode)
            return
        edit = getattr(self.control, "edit", None)
        if isinstance(edit, QLineEdit):
            self.control.setEnabled(self._mode != "disabled")
            edit.setReadOnly(self._mode != "edit")
        else:
            # 没有只读态的控件（勾选、开关、按钮）在 readonly 下只能禁用。
            self.control.setEnabled(self._mode == "edit")

    def value(self):
        return _value_of(self.control)


class FormGrid(QWidget):
    """若干 FormRow 的纵向网格；按 key 控制显隐与只读。"""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._body = QVBoxLayout(self)
        self._body.setContentsMargins(0, 0, 0, 0)
        self._body.setSpacing(tokens.space(12))
        self._rows: dict[str, FormRow] = {}
        self._order: list[str] = []

    def add(self, row: FormRow, key: str | None = None) -> FormRow:
        resolved = key if key is not None else row.label.text()
        if not resolved:
            raise ValueError("FormGrid.add 需要 key，或给 FormRow 一个非空标签")
        if resolved in self._rows:
            raise ValueError(f"FormGrid key 重复：{resolved!r}")
        self._rows[resolved] = row
        self._order.append(resolved)
        self._body.addWidget(row)
        return row

    def row(self, key: str) -> FormRow | None:
        return self._rows.get(key)

    def keys(self) -> tuple[str, ...]:
        return tuple(self._order)

    def set_visible(self, keys: str | Iterable[str], visible: bool) -> None:
        for key in _keys(keys):
            row = self._rows.get(key)
            if row is not None:
                row.setVisible(bool(visible))

    def set_read_only(self, keys: str | Iterable[str], read_only: bool) -> None:
        for key in _keys(keys):
            row = self._rows.get(key)
            if row is not None:
                row.set_mode("readonly" if read_only else "edit")

    def values(self, visible_only: bool = False) -> dict[str, object]:
        result: dict[str, object] = {}
        for key in self._order:
            row = self._rows[key]
            if visible_only and row.isHidden():
                continue
            result[key] = row.value()
        return result


class PathRow(QWidget):
    """路径输入 + 浏览按钮；浏览逻辑由页面注入，控件不弹任何对话框。"""

    browseRequested = Signal()

    def __init__(
        self,
        text: str = "",
        placeholder: str = "",
        browse=None,
        size: str | int = "xl",
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._browse = browse
        self.field = primitives.Field(
            kind="text", text=text, placeholder=placeholder, size=size
        )
        self.browse_button = primitives.Button(
            "浏览", kind="secondary", size="lg"
        )
        self.browse_button.setAccessibleName("浏览路径")
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))
        row.addWidget(self.field, 1)
        row.addWidget(self.browse_button, 0, Qt.AlignmentFlag.AlignVCenter)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.browse_button.clicked.connect(self._browse_path)

    @property
    def edit(self) -> QLineEdit | None:
        return self.field.edit

    @property
    def returnPressed(self):
        return self.field.returnPressed

    def set_browse_handler(self, handler) -> None:
        """handler(parent) -> str | None；返回非空路径时写回输入框。"""
        self._browse = handler

    def _browse_path(self) -> None:
        self.browseRequested.emit()
        if self._browse is None:
            return
        result = self._browse(self)
        if isinstance(result, str) and result:
            self.setText(result)

    def text(self) -> str:
        return self.field.text()

    def setText(self, value: str) -> None:  # noqa: N802 - Qt 命名
        self.field.setText(value)

    def value(self) -> str:
        return self.field.text()

    def path(self) -> str:
        return self.field.text()

    def set_path(self, value: str) -> None:
        self.field.setText(value)

    def setPlaceholderText(self, value: str) -> None:  # noqa: N802 - Qt 命名
        self.field.setPlaceholderText(value)

    def setFocus(self) -> None:  # noqa: N802 - Qt 命名
        self.field.setFocus()

    def set_form_mode(self, mode: str) -> None:
        self.field.set_form_mode(mode)
        self.browse_button.setEnabled(mode == "edit")


class _CopyBox(QWidget):
    """只读字段 + 复制按钮；复制后短暂显示“已复制”。"""

    copied = Signal(str)

    def __init__(
        self,
        value: str = "",
        reset_ms: int = 1500,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._reset_ms = reset_ms
        self.field = primitives.Field(kind="readonly", text=value, size="xl")
        self.button = primitives.Button("复制", kind="secondary", size="lg")
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))
        row.addWidget(self.field, 1)
        row.addWidget(self.button, 0, Qt.AlignmentFlag.AlignVCenter)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

        # 递增代际：连续复制时只有最后一次的定时器允许复位。
        self._generation = 0
        self.button.clicked.connect(self.copy)

    def copy(self) -> None:
        value = self.field.text()
        if QGuiApplication.instance() is not None:
            clipboard = QGuiApplication.clipboard()
            if clipboard is not None:
                clipboard.setText(value)
        self.button.setText("已复制")
        self._generation += 1
        generation = self._generation
        QTimer.singleShot(
            self._reset_ms, self, lambda: self._reset(generation)
        )
        self.copied.emit(value)

    def _reset(self, generation: int) -> None:
        if generation != self._generation:
            return
        try:
            self.button.setText("复制")
        except RuntimeError:
            # 控件已销毁时定时器仍可能回来一次。
            pass

    def text(self) -> str:
        return self.field.text()

    def setText(self, value: str) -> None:  # noqa: N802 - Qt 命名
        self.field.setText(value)

    def value(self) -> str:
        return self.field.text()

    def set_form_mode(self, mode: str) -> None:
        # 展示值永远只读；edit/readonly 只影响复制按钮是否可用。
        if mode == "disabled":
            self.field.set_form_mode("disabled")
            self.button.setEnabled(False)
        else:
            self.field.set_form_mode("readonly")
            self.button.setEnabled(True)


class CopyRow(FormRow):
    """带复制按钮的只读一行；``reset_ms`` 便于测试缩短复位时间。"""

    def __init__(
        self,
        label: str = "",
        value: str = "",
        reset_ms: int = 1500,
        hint: str = "",
        parent: QWidget | None = None,
    ) -> None:
        self.box = _CopyBox(value, reset_ms=reset_ms)
        super().__init__(label, self.box, hint=hint, parent=parent)
        self.copied = self.box.copied

    @property
    def field(self) -> primitives.Field:
        return self.box.field

    @property
    def button(self) -> primitives.Button:
        return self.box.button

    def copy(self) -> None:
        self.box.copy()

    def text(self) -> str:
        return self.box.text()

    def setText(self, value: str) -> None:  # noqa: N802 - Qt 命名
        self.box.setText(value)

    def value(self) -> str:
        return self.box.value()


class DangerRow(FormRow):
    """危险操作用一行：标签 + danger 按钮，点击只发信号，不做确认。"""

    clicked = Signal()

    def __init__(
        self,
        label: str = "",
        text: str = "删除",
        hint: str = "",
        parent: QWidget | None = None,
        on_click=None,
    ) -> None:
        if callable(text):
            on_click = text
            text = "删除"
        self.button = primitives.Button(text, kind="danger", size="lg")
        super().__init__(label, self.button, hint=hint, parent=parent)
        self.button.clicked.connect(self.clicked)
        if on_click is not None:
            self.clicked.connect(on_click)

    def _apply_mode(self) -> None:
        self.label.setEnabled(self._mode != "disabled")
        self.button.setEnabled(self._mode == "edit")


def _value_of(control: QWidget):
    value = getattr(control, "value", None)
    if callable(value):
        return value()
    checked = getattr(control, "isChecked", None)
    if callable(checked):
        return bool(checked())
    text = getattr(control, "text", None)
    if callable(text):
        return text()
    return ""
