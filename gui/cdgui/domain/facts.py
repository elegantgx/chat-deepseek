"""`info` 派生的只读事实。

这些对象只能由 CLI 输出创建：`HostConfig.from_info` / `ServiceStatus.from_info`
是唯一入口，避免 UI 或 controller 自己拼 `service_*` 标志。`active ⇒ installed`
不变量由 `state.assert_invariants` 检查。
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import parsing

from .target import StrEnum


@dataclass(frozen=True)
class ServiceStatus:
    supported: bool = False
    installed: bool = False
    active: bool = False
    enabled: bool = False
    linger: bool = False
    scope: str = ""
    unit: str = ""

    @classmethod
    def from_info(cls, info: parsing.Info) -> ServiceStatus:
        """唯一入口：`info` 的 `service_*` 字段原样映射。"""
        return cls(
            supported=info.service_supported,
            installed=info.service_installed,
            active=info.service_active,
            enabled=info.service_enabled,
            linger=info.service_linger,
            scope=info.service_scope,
            unit=info.service_unit,
        )


@dataclass(frozen=True)
class HostConfig:
    """当前目标自己的 `config.json` 快照（经 `info` 读出）。"""

    target_key: str
    version: str
    os: str
    arch: str
    initialized: bool
    listen: str
    public_url: str
    api_origin: str
    backup_dir: str
    service: ServiceStatus
    # 计划里没列这一项：远端 `Target.data_dir` 为空时，展示和 `config set`
    # 都要用 `info` 回填的生效目录，所以放在 HostConfig 里保存。
    data_dir: str = ""

    @classmethod
    def from_info(cls, target_key: str, info: parsing.Info) -> HostConfig:
        """唯一入口：不会出现“窗口自己拼一份 HostConfig”的第二条路径。"""
        if not target_key:
            raise ValueError("HostConfig 需要 target_key")
        return cls(
            target_key=target_key,
            version=info.version,
            os=info.os,
            arch=info.arch,
            initialized=info.initialized,
            listen=info.listen,
            public_url=info.public_url,
            api_origin=info.api_origin,
            backup_dir=info.backup_dir,
            service=ServiceStatus.from_info(info),
            data_dir=info.data_dir,
        )


class ForegroundPhase(StrEnum):
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"


@dataclass(frozen=True)
class ForegroundSession:
    """GUI 自己启动的 `serve` 会话；同时最多一个。"""

    target_key: str
    phase: ForegroundPhase = ForegroundPhase.STARTING
    address: str = ""
    url: str = ""
    tail: tuple[str, ...] = ()

    def with_tail(self, lines: tuple[str, ...]) -> ForegroundSession:
        """只保留最近 40 行，避免日志无限增长。"""
        return replace(self, tail=tuple(lines[-40:]))

    def with_phase(
        self,
        phase: ForegroundPhase,
        *,
        address: str | None = None,
        url: str | None = None,
    ) -> ForegroundSession:
        return replace(
            self,
            phase=ForegroundPhase(phase),
            address=self.address if address is None else address,
            url=self.url if url is None else url,
        )
