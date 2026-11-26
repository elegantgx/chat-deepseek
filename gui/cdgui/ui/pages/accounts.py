"""账户页骨架；真实列表与权限操作由 C5c 填充。"""

from __future__ import annotations

from .base import Page, PageId


class AccountsPage(Page):
    def __init__(self, controller) -> None:
        super().__init__(
            controller,
            page_id=PageId.ACCOUNTS,
            title="账户",
            description="账户列表、组标签与权限操作将在这里显示。",
        )
