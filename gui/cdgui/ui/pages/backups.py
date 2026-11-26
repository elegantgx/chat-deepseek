"""备份页骨架；真实备份列表与恢复操作由 C5c 填充。"""

from __future__ import annotations

from .base import Page, PageId


class BackupsPage(Page):
    def __init__(self, controller) -> None:
        super().__init__(
            controller,
            page_id=PageId.BACKUPS,
            title="备份",
            description="备份记录、备份地址与恢复操作将在这里显示。",
        )
