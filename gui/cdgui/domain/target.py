"""连接端点与冻结后的目标。

`Endpoint` 是 `config.gui.json` 里的事实（连接方式、主机、路径）；`resolve_target`
把它校验并冻结成 `Target`。`Target.key` 唯一标识一次“本机/远端 + 二进制 + 数据
目录”的组合，切换目标时用它判断状态是否作废。

本模块只用标准库，路径规则与 `dialogs.py` / `app.py` 的现有校验保持一致；
C6 之后设置页和主窗口都只走 `resolve_target`，不再各写一套。
"""

from __future__ import annotations

import os
import posixpath
from dataclasses import dataclass, replace
from enum import Enum
from pathlib import Path


class StrEnum(str, Enum):
    """Python 3.10 兼容的字符串枚举（`enum.StrEnum` 要 3.11）。"""

    def __str__(self) -> str:
        return self.value


class ConnectionKind(StrEnum):
    LOCAL = "local"
    SSH = "ssh"


class Capability(StrEnum):
    """目标支持的能力；远端差异集中在这里，不在 UI 里写 `if remote`。"""

    FOREGROUND_SERVE = "foreground_serve"
    OPEN_PAGE = "open_page"
    SAVE_BACKUP_AS = "save_backup_as"
    # 别名：ActionId.BACKUP_AS 对应的能力；枚举值相同，迭代时只出现一次。
    BACKUP_AS = "save_backup_as"
    PICK_LOCAL_PATH = "pick_local_path"


class TargetError(ValueError):
    """配置无法解析成可用目标；消息直接展示给用户。"""


@dataclass(frozen=True)
class Endpoint:
    """`config.gui.json` 里的原始连接配置。"""

    kind: ConnectionKind = ConnectionKind.LOCAL
    host: str = ""
    binary_dir: str = ""
    data_dir: str = ""


def binary_name() -> str:
    """与 `cli.binary_name()` 一致：Windows 带 .exe。"""
    return "chat-deepseek.exe" if os.name == "nt" else "chat-deepseek"


def remote_binary(binary_dir: str) -> str:
    """远端固定 `<目录>/chat-deepseek`；远端没有 Windows .exe 形态。"""
    return posixpath.join(binary_dir, "chat-deepseek")


def _local_binary(binary_dir: str) -> str:
    text = binary_dir.strip()
    if not text:
        raise TargetError("请选择 chat-deepseek 所在的二进制目录")
    path = Path(text).expanduser()
    if path.is_file():
        return str(path.resolve())
    candidate = path / binary_name()
    if candidate.is_file():
        return str(candidate.resolve())
    raise TargetError(f"目录里没有 {binary_name()}：{path}")


def resolve_target(endpoint: Endpoint) -> Target:
    """校验 Endpoint 并冻结成 Target。

    本机接受“目录或可执行文件”（修复现状设置页与主窗口两套规则）；远端要求
    绝对的二进制目录，数据目录可留空交给远端 CLI 默认值，且原样保留、不展开 `~`。
    """
    kind = ConnectionKind(endpoint.kind)
    host = endpoint.host.strip()
    binary_dir = endpoint.binary_dir.strip()
    data_dir = endpoint.data_dir.strip()

    if kind is ConnectionKind.LOCAL:
        binary = _local_binary(binary_dir)
        if not data_dir:
            raise TargetError("数据目录不能为空")
        data_dir = str(Path(data_dir).expanduser())
        endpoint = Endpoint(
            kind=kind,
            host="",
            binary_dir=binary_dir,
            data_dir=endpoint.data_dir.strip(),
        )
    else:
        if not host:
            raise TargetError("请填写 SSH 主机")
        if not binary_dir:
            raise TargetError("请填写远端二进制目录")
        if not posixpath.isabs(binary_dir):
            raise TargetError("远端二进制目录必须是绝对路径")
        if data_dir and not posixpath.isabs(data_dir):
            raise TargetError("远端数据目录必须是绝对路径，留空使用远端默认值")
        binary = remote_binary(binary_dir)
        endpoint = Endpoint(
            kind=kind,
            host=host,
            binary_dir=binary_dir,
            data_dir=data_dir,
        )

    return Target(endpoint=endpoint, binary=binary, data_dir=data_dir)


@dataclass(frozen=True)
class Target:
    """一次冻结后的管理目标；切换目标时整个对象替换。"""

    endpoint: Endpoint
    binary: str
    data_dir: str  # "" 仅 SSH：交给远端 CLI 默认值

    @property
    def key(self) -> str:
        """包含 connection/host/binary/data_dir，任意一项变化都得到新 key。"""
        return "|".join(
            (
                self.endpoint.kind.value,
                self.endpoint.host,
                self.binary,
                self.data_dir,
            )
        )

    @property
    def remote(self) -> bool:
        return self.endpoint.kind is ConnectionKind.SSH

    @property
    def connection(self) -> ConnectionKind:
        return self.endpoint.kind

    @property
    def host(self) -> str:
        return self.endpoint.host

    def supports(self, capability: Capability) -> bool:
        """远端不支持“备份到本地文件”和本地路径选择；打开页面仍支持，
        但 `rules.page_url` 只认远端 Public URL。"""
        cap = Capability(capability)
        if cap in (Capability.SAVE_BACKUP_AS, Capability.PICK_LOCAL_PATH):
            return not self.remote
        return True


def with_data_dir(target: Target, data_dir: str) -> Target:
    """远端数据目录由 `info` 回填后派生新 Target（key 随之变化）。"""
    endpoint = replace(target.endpoint, data_dir=data_dir)
    return replace(target, endpoint=endpoint, data_dir=data_dir)
