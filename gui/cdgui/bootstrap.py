"""应用装配：配置 → 目标 → 传输 → controller → 窗口。

`app.py` 只调用本模块的 `build_application()`；这里集中处理首次启动的默认值、
v1/v2→v3 迁移和“路径配错也要能建窗口”的兜底，避免启动入口再长出逻辑。

兜底原则：`resolve_target` 失败时**不退出**。设置页需要窗口才能打开，所以用
`find_binary()` / `server_config.defaults()` 造一个 best-effort `Target`，把原始
`Endpoint` 留在里面，用户修好路径后由 controller.apply_target 重新校验。
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Callable

import gui_config
import server_config

from .controller import Controller
from .domain.target import (
    ConnectionKind,
    Endpoint,
    Target,
    TargetError,
    remote_binary,
    resolve_target,
)
from .infra.process import find_binary
from .infra.transport import LocalTransport, SshTransport, Transport
from .ui.main_window import MainWindow

Factory = Callable[[Target], Transport]


def load_config(path: Path | None = None) -> tuple[gui_config.Config, Path]:
    """读取 GUI 配置；空配置按 `seed_paths()` 找模板，迁移过就写回。

    写回失败（只读配置目录）不阻止启动：内存里已经是 v3，下次启动再试。
    """
    config_path = Path(path) if path is not None else gui_config.default_path()
    config = gui_config.load(config_path)
    if config.empty:
        for seed in gui_config.seed_paths():
            candidate = gui_config.load(seed)
            if not candidate.empty:
                config = candidate
                break
    if config.connection not in gui_config.CONNECTIONS:
        config = replace(config, connection=gui_config.DEFAULT_CONNECTION)
    if config.migrated:
        try:
            gui_config.save(config_path, config)
        except OSError:
            pass
    return config, config_path


def endpoint_for(config: gui_config.Config) -> Endpoint:
    """把配置里的 local/ssh 两段压成一个 `Endpoint`。"""
    if config.connection != "ssh":
        return Endpoint(
            kind=ConnectionKind.LOCAL,
            host="",
            binary_dir=config.local.binary_dir,
            data_dir=config.local.data_dir,
        )
    return Endpoint(
        kind=ConnectionKind.SSH,
        host=config.ssh.host,
        binary_dir=config.ssh.binary_dir,
        data_dir=config.ssh.data_dir,
    )


def make_transport(target: Target) -> Transport:
    """目标到执行通道：远端常驻 SSH，本机每条命令一个子进程。"""
    if target.remote:
        return SshTransport(target)
    return LocalTransport(target)


def resolve_startup_target(endpoint: Endpoint) -> Target:
    """校验配置；失败时返回 best-effort 目标，让设置页仍能打开修路径。"""
    try:
        return resolve_target(endpoint)
    except TargetError:
        return _fallback_target(endpoint)


def _fallback_target(endpoint: Endpoint) -> Target:
    if endpoint.kind is ConnectionKind.SSH:
        # 远端只拼 `<binary_dir>/chat-deepseek`；空目录时得到裸文件名，
        # 界面会提示重新填写，不会真去执行。
        return Target(
            endpoint=endpoint,
            binary=remote_binary(endpoint.binary_dir),
            data_dir=endpoint.data_dir,
        )

    binary = Path(find_binary()).expanduser()
    defaults = server_config.defaults(binary.parent)
    # 只有二进制路径坏了；数据目录是用户填的，能用就保留，别让 info 去读默认目录。
    data_dir = endpoint.data_dir.strip() or defaults["data_dir"]
    fallback = Endpoint(
        kind=ConnectionKind.LOCAL,
        binary_dir=defaults["binary"],
        data_dir=data_dir,
    )
    try:
        return resolve_target(fallback)
    except TargetError:
        return Target(endpoint=fallback, binary=str(binary), data_dir=data_dir)


def build_application(
    *,
    transport_factory: Factory | None = None,
) -> tuple[MainWindow, Controller]:
    """装配并返回窗口与 controller；调用方负责 `window.show()` / `app.exec()`。

    `transport_factory` 只给测试注入 fake 用；生产路径传 None 走真通道。
    """
    config, config_path = load_config()
    target = resolve_startup_target(endpoint_for(config))

    factory = transport_factory if transport_factory is not None else make_transport
    transport = factory(target)
    controller = Controller(
        target=target,
        transport=transport,
        config=config,
        config_path=config_path,
        transport_factory=factory,
    )
    window = MainWindow(controller)

    controller.bootstrap()
    controller.migrate_legacy_backup_dir(config.legacy_backup_dir)
    return window, controller


__all__ = [
    "build_application",
    "endpoint_for",
    "load_config",
    "make_transport",
    "resolve_startup_target",
]
