"""服务页骨架；真实状态区和操作按钮由 C5c 填充。"""

from __future__ import annotations

from .base import Page, PageId


class ServicePage(Page):
    def __init__(self, controller) -> None:
        super().__init__(
            controller,
            page_id=PageId.SERVICE,
            title="服务",
            description="服务状态、运行方式与日志将在这里显示。",
        )
