"""页面协议：PageId、Page 基类与最小骨架布局。

页面对象常驻 ``QStackedWidget``，只拿 controller 引用；它们不自己存业务状态，
也不判断权限/服务状态。C5c/C5d 在子类里补真实内容时，按钮的可见性、启用态
和文案统一取 ``UiState.buttons[ActionId]``。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtWidgets import QLabel, QVBoxLayout, QWidget

from ...domain.state import PageId
from .. import tokens
from ..primitives import SectionHeading

if TYPE_CHECKING:
    from ...domain.state import AppState
    from ..protocols import ControllerProtocol
    from ..render import UiState

__all__ = ["Page", "PageId"]


class Page:
    """一个页面 = 标题 + 占位说明 + widget；子类按需覆盖 render/can_leave。"""

    def __init__(
        self,
        controller: "ControllerProtocol",
        *,
        page_id: PageId,
        title: str,
        description: str,
    ) -> None:
        self.controller = controller
        self.page_id = PageId(page_id)
        self.title = title
        self.description = description

        self.widget = QWidget()
        self.widget.setObjectName(f"cdguiPage_{self.page_id.value}")
        self.body = QVBoxLayout(self.widget)
        self.body.setContentsMargins(
            tokens.space(24), tokens.space(20), tokens.space(24), tokens.space(20)
        )
        self.body.setSpacing(tokens.space(12))

        self.heading = SectionHeading(title, self.widget)
        self.body.addWidget(self.heading)

        self.placeholder = QLabel(description, self.widget)
        self.placeholder.setFont(tokens.font(12))
        self.placeholder.setProperty("tone", "muted")
        self.placeholder.setWordWrap(True)
        self.body.addWidget(self.placeholder)
        self.body.addStretch(1)

    def render(self, ui: "UiState", state: "AppState | None") -> None:
        """真实内容由 C5c/C5d 填充；骨架不写任何控件。"""

    def on_activate(self) -> None:
        """页面被切到前台时调用（例如懒刷新列表）；骨架无动作。"""

    def can_leave(self) -> bool:
        """切页前给页面一次拦截机会；返回 False 留在原页。"""
        return True
