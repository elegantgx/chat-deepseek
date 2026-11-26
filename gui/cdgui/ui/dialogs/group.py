"""授予 / 撤销组表单：User、Admin、Owner 三行，默认 Admin。"""

from __future__ import annotations

from PySide6.QtWidgets import QButtonGroup, QVBoxLayout, QWidget

from .. import forms, primitives, tokens
from .base import FormDialog

#: 固定组名单，顺序与旧对话框、CLI 一致。
GROUPS = ("User", "Admin", "Owner")

#: 默认选中的组；授予与撤销都从 Admin 开始。
DEFAULT_GROUP = "Admin"


class GroupForm(FormDialog):
    """选择要授予/撤销的组；``value`` 为组名，取消时为 ``None``。"""

    def __init__(
        self,
        parent: QWidget | None,
        username: str = "",
        add: bool = True,
    ) -> None:
        self.username = username
        self.add_mode = bool(add)
        title = "授予组" if add else "撤销组"
        description = f"{'授予' if add else '撤销'} {username} 的组"
        super().__init__(
            parent,
            title,
            description,
            width=420,
            submit_text="确定",
            body_max_height=280,
        )

        self.choices: list[primitives.Choice] = []
        self.group = QButtonGroup(self)
        self.group.setExclusive(True)
        holder = QWidget()
        column = QVBoxLayout(holder)
        column.setContentsMargins(0, 0, 0, 0)
        column.setSpacing(tokens.space(4))
        for index, name in enumerate(GROUPS):
            choice = primitives.Choice(name, kind="row")
            choice.setChecked(name == DEFAULT_GROUP)
            self.group.addButton(choice, index)
            column.addWidget(choice)
            self.choices.append(choice)
        self.grid.add(forms.FormRow("选择组", holder), key="group")
        self._initial_focus = self.group.checkedButton()

    def checked_group(self) -> str | None:
        checked = self.group.checkedButton()
        return checked.text() if checked is not None else None

    def form_error(self) -> str:
        return "" if self.checked_group() is not None else "请选择一个组"

    def form_value(self):
        return self.checked_group()
