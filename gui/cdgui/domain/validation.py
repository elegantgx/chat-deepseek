"""表单校验纯函数。

文案与 `dialogs.py` 现有提示一致，C5 直接拿来显示；空串表示通过。这里只做
字符串/路径规则，不碰文件系统（二进制是否存在由 `target.resolve_target` 判断）。
"""

from __future__ import annotations

import posixpath
from pathlib import Path
from urllib.parse import urlsplit

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 1024


def password_error(password: str) -> str:
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        return (
            f"密码长度需在 {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} 位之间"
        )
    return ""


def login_password_error(password: str) -> str:
    """登录只要求非空，长度规则留给创建/重置密码。"""
    return "" if password else "请输入密码"


def password_confirm_error(password: str, confirm: str) -> str:
    error = password_error(password)
    if error:
        return error
    if password != confirm:
        return "两次输入的密码不一致"
    return ""


def is_http_url(value: str) -> bool:
    """与 CLI 一致：只接受 http/https 且有主机名。"""
    text = value.strip()
    if not (text.startswith("http://") or text.startswith("https://")):
        return False
    parsed = urlsplit(text)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def url_error(value: str, label: str, *, required: bool = False) -> str:
    text = value.strip()
    if not text:
        return f"{label}不能为空" if required else ""
    if not is_http_url(text):
        return f"{label}必须以 http:// 或 https:// 开头"
    return ""


def public_url_error(value: str) -> str:
    # 与 dialogs.py 的文案一致：英文标签和“必须”之间有一个空格。
    return url_error(value, "Public URL ")


def api_origin_error(value: str) -> str:
    return url_error(value, "API 地址")


def listen_error(value: str) -> str:
    return "" if value.strip() else "监听地址不能为空"


def host_error(value: str) -> str:
    return "" if value.strip() else "请填写 SSH 主机"


def local_binary_dir_error(value: str) -> str:
    return "" if value.strip() else "请选择二进制目录"


def local_data_dir_error(value: str) -> str:
    return "" if value.strip() else "数据目录不能为空"


def is_absolute_path(value: str, *, remote: bool) -> bool:
    """远端用 POSIX 规则且不展开 `~`；本机展开 `~` 后判断。"""
    text = value.strip()
    if not text:
        return False
    if remote:
        return posixpath.isabs(text)
    return Path(text).expanduser().is_absolute()


def remote_binary_dir_error(value: str) -> str:
    text = value.strip()
    if not text:
        return "请填写远端二进制目录"
    if not is_absolute_path(text, remote=True):
        return "远端二进制目录必须是绝对路径"
    return ""


def remote_data_dir_error(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    if not is_absolute_path(text, remote=True):
        return "远端数据目录必须是绝对路径，留空使用远端默认值"
    return ""


def backup_dir_error(value: str, *, remote: bool) -> str:
    text = value.strip()
    if not text:
        return ""
    if not is_absolute_path(text, remote=remote):
        return "备份地址必须是绝对路径，留空表示默认目录"
    return ""
