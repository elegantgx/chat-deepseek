"""设置页骨架；连接表单与当前主机配置由 C5d 填充。"""

from __future__ import annotations

from .base import Page, PageId


class SettingsPage(Page):
    def __init__(self, controller) -> None:
        super().__init__(
            controller,
            page_id=PageId.SETTINGS,
            title="设置",
            description="连接方式、服务端配置与管理登录将在这里显示。",
        )

    def can_leave(self) -> bool:
        # C5d 会在这里拦未保存的连接草稿；骨架阶段没有草稿可丢。
        return True
