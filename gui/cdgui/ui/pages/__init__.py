"""四个页面对象；C5b 只提供骨架，C5c/C5d 在各自模块里填真实内容。"""

from __future__ import annotations

from .accounts import AccountsPage
from .backups import BackupsPage
from .base import Page, PageId
from .service import ServicePage
from .settings import SettingsPage

__all__ = [
    "AccountsPage",
    "BackupsPage",
    "Page",
    "PageId",
    "ServicePage",
    "SettingsPage",
]
