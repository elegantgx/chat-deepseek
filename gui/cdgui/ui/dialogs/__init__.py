"""C5d 对话框包：账户、密码、组、确认、消息、服务安装与备份记录。

C5b 的窗口骨架会 ``from . import dialogs``，这里必须直接提供页面常用的
函数与表单类，不再让页面去认识旧 ``gui/dialogs.py``。
"""

from __future__ import annotations

from .account import AccountForm
from .backup_records import BackupRecordsDialog
from .base import FormDialog, SheetDialog
from .confirm import ConfirmDialog, ask_confirm
from .group import GroupForm
from .message import MessageDialog, show_message
from .password import PasswordForm
from .service_install import ServiceInstallSheet

__all__ = [
    "AccountForm",
    "BackupRecordsDialog",
    "ConfirmDialog",
    "FormDialog",
    "GroupForm",
    "MessageDialog",
    "PasswordForm",
    "ServiceInstallSheet",
    "SheetDialog",
    "ask_confirm",
    "show_message",
]
