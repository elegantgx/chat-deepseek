"""对话框基类：原生标题栏 + 标题/说明 + 可滚动 body + 底部按钮。

对话框不使用 frameless，也不再自绘窗口外壳；标题栏、边框和圆角全部交给
系统。内容只放 C5a 的控件与表单原语，按钮统一走 ``Button``。

``SheetDialog`` 负责外壳与错误提示，``FormDialog`` 再叠一层 ``FormGrid``
和提交校验：子类只实现 ``form_error`` / ``form_value``，不再各自拼窗口。
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from .. import forms, primitives, tokens

#: 对话框默认宽度；各子类按内容宽度覆盖。
DEFAULT_WIDTH = 460

#: 可滚动 body 的最大高度，超过后出现纵向滚动条。
DEFAULT_BODY_MAX_HEIGHT = 420

#: 底部按钮的最小宽度（来自设计尺度）。
BUTTON_MIN_WIDTH = tokens.min_width(88)


class SheetDialog(QDialog):
    """所有新对话框的外壳。

    布局从上到下：标题、说明、可滚动 body、错误红字、底部按钮。错误标签
    常驻但默认隐藏，校验失败时用 ``_show_error`` 显示，不额外弹窗。
    """

    def __init__(
        self,
        parent: QWidget | None,
        title: str,
        description: str = "",
        *,
        width: int = DEFAULT_WIDTH,
        body_max_height: int = DEFAULT_BODY_MAX_HEIGHT,
    ) -> None:
        super().__init__(parent)
        self.value: object = None
        self._body_max_height = body_max_height
        self._sized = False
        self._initial_focus: QWidget | None = None
        self._default_button: primitives.Button | None = None

        self.setWindowTitle(title)
        self.setObjectName("cdguiSheet")
        self.setModal(True)
        self.setWindowFlag(Qt.WindowType.WindowContextHelpButtonHint, False)
        self.setMinimumWidth(width)
        self.resize(width, 200)

        root = QVBoxLayout(self)
        root.setContentsMargins(
            tokens.space(24), tokens.space(16), tokens.space(24), tokens.space(20)
        )
        root.setSpacing(tokens.space(12))

        self.title_label = QLabel(title, self)
        self.title_label.setObjectName("cdguiSheetTitle")
        self.title_label.setFont(tokens.font(15, 600))
        self.title_label.setWordWrap(True)
        root.addWidget(self.title_label)

        self.description_label = QLabel(description, self)
        self.description_label.setObjectName("cdguiSheetDescription")
        self.description_label.setFont(tokens.font(12))
        self.description_label.setProperty("tone", "muted")
        self.description_label.setWordWrap(True)
        self.description_label.setVisible(bool(description))
        root.addWidget(self.description_label)

        self.scroll = QScrollArea(self)
        self.scroll.setObjectName("cdguiSheetScroll")
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.scroll.setVerticalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAsNeeded
        )
        self._content = QWidget()
        self.body = QVBoxLayout(self._content)
        self.body.setContentsMargins(0, 0, 0, 0)
        self.body.setSpacing(tokens.space(12))
        self.scroll.setWidget(self._content)
        root.addWidget(self.scroll, 1)

        self._error = QLabel("", self)
        self._error.setObjectName("cdguiSheetError")
        self._error.setFont(tokens.font(12))
        self._error.setProperty("tone", "danger")
        self._error.setWordWrap(True)
        self._error.setVisible(False)
        root.addWidget(self._error)
        self.error_label = self._error

        self.footer = QHBoxLayout()
        self.footer.setContentsMargins(0, tokens.space(4), 0, 0)
        self.footer.setSpacing(tokens.space(8))
        self.footer.addStretch(1)
        root.addLayout(self.footer)

        self.primary_button: primitives.Button | None = None
        self.cancel_button: primitives.Button | None = None

    # -- 内容 --------------------------------------------------------------

    def add(self, widget: QWidget, stretch: int = 0) -> QWidget:
        """往可滚动 body 追加控件。"""
        self.body.addWidget(widget, stretch)
        return widget

    def add_layout(self, layout, stretch: int = 0) -> None:
        self.body.addLayout(layout, stretch)

    def add_stretch(self) -> None:
        self.body.addStretch(1)

    def set_description(self, text: str) -> None:
        self.description_label.setText(text)
        self.description_label.setVisible(bool(text))

    # -- 错误提示 ----------------------------------------------------------

    def _show_error(self, message: str) -> None:
        self._error.setText(message)
        self._error.setVisible(bool(message))

    def _clear_error(self) -> None:
        self._error.setText("")
        self._error.setVisible(False)

    # -- 底部按钮 ----------------------------------------------------------

    def add_button(
        self,
        text: str,
        kind: str = "secondary",
        *,
        default: bool = False,
        on_click=None,
        min_width: int = BUTTON_MIN_WIDTH,
    ) -> primitives.Button:
        button = primitives.Button(text, kind=kind, size="lg", parent=self)
        button.setMinimumWidth(min_width)
        if on_click is not None:
            button.clicked.connect(on_click)
        self.footer.addWidget(button)
        if default:
            self.set_default_button(button)
        return button

    def set_default_button(self, button: primitives.Button) -> None:
        """同一时间只有一个默认按钮；Enter 跟随它。"""
        if self._default_button is not None and self._default_button is not button:
            self._default_button.setDefault(False)
        self._default_button = button
        button.setDefault(True)

    def buttons(
        self,
        primary: str,
        on_primary,
        *,
        cancel: str = "取消",
        danger: bool = False,
        default: str = "primary",
    ) -> primitives.Button:
        """取消 + 主按钮的常见组合；``default`` 控制默认焦点。"""
        self.cancel_button = None
        if cancel:
            self.cancel_button = self.add_button(
                cancel,
                kind="secondary",
                on_click=self.reject,
                default=default == "cancel",
            )
            if default == "cancel":
                self._initial_focus = self.cancel_button
        self.primary_button = self.add_button(
            primary,
            kind="danger" if danger else "primary",
            on_click=on_primary,
            default=default == "primary",
        )
        return self.primary_button

    # -- 尺寸与显示 --------------------------------------------------------

    def _fit_body(self) -> None:
        """按内容高度定 body 可视高度，超过上限就交给滚动条。

        用 ``heightForWidth`` 计算换行后的真实高度；直接取 ``sizeHint`` 会按
        单行宽度估算，长消息展示时只剩一行可视区。
        """
        self.layout().activate()
        available = max(
            self.width() - tokens.space(24) * 2, tokens.min_width(260)
        )
        layout = self._content.layout()
        hint = 0
        if layout is not None and layout.hasHeightForWidth():
            hint = layout.heightForWidth(available)
        if hint <= 0:
            hint = self._content.sizeHint().height()
        if hint <= 0:
            return
        self.scroll.setFixedHeight(
            max(tokens.height(40), min(hint, self._body_max_height))
        )

    def _prepare_size(self) -> None:
        if self._sized:
            return
        self._sized = True
        self._fit_body()
        self.adjustSize()

    def showEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        super().showEvent(event)
        self._prepare_size()
        if self._initial_focus is not None:
            self._initial_focus.setFocus()
        elif self._default_button is not None:
            self._default_button.setFocus()

    def exec_modal(self):
        """居中后模态显示，返回 ``value``；关闭窗口得到 ``None``。"""
        self._prepare_size()
        self.adjustSize()
        self._center()
        self.exec()
        return self.value

    def _center(self) -> None:
        parent = self.parentWidget()
        if parent is None:
            return
        geo = parent.window().frameGeometry()
        frame = self.frameGeometry()
        self.move(
            geo.center().x() - frame.width() // 2,
            geo.center().y() - frame.height() // 2,
        )


class FormDialog(SheetDialog):
    """``FormGrid`` + 提交校验的对话框。

    子类往 ``self.grid`` 加 ``FormRow``，实现 ``form_error`` 返回第一条错误
    （空串表示通过）和 ``form_value`` 返回结果；按下提交按钮时统一校验、
    显示红字或写 ``value`` 后关闭。
    """

    def __init__(
        self,
        parent: QWidget | None,
        title: str,
        description: str = "",
        *,
        width: int = DEFAULT_WIDTH,
        submit_text: str = "确定",
        body_max_height: int = 360,
    ) -> None:
        super().__init__(
            parent,
            title,
            description,
            width=width,
            body_max_height=body_max_height,
        )
        self.grid = forms.FormGrid(self._content)
        self.add(self.grid)
        self.buttons(submit_text, self.submit)

    def form_error(self) -> str:
        """返回第一条错误文案；空串表示校验通过。"""
        return ""

    def form_value(self):
        """校验通过后写入 ``value`` 的纯值。"""
        return None

    def submit(self) -> bool:
        error = self.form_error()
        if error:
            self._show_error(error)
            return False
        self._clear_error()
        self.value = self.form_value()
        self.accept()
        return True
