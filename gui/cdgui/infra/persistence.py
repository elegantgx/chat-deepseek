"""GUI 本地配置的持久化入口。

`gui_config.py` 是稳定契约层（117 个旧测试锁着），这里只做薄封装：加载返回
`gui_config.Config`，保存直接透传 `gui_config.save`。保存失败按 OSError 抛给
调用方，由 controller 决定如何提示，基础设施层不弹窗、不吞异常。
"""

from __future__ import annotations

from pathlib import Path

import gui_config


class GuiConfigRepository:
    """读写 `config.gui.json`；默认路径按平台推导。"""

    def __init__(self, path: str | Path | None = None) -> None:
        self._path = Path(path) if path is not None else gui_config.default_path()

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> gui_config.Config:
        return gui_config.load(self._path)

    def save(self, config: gui_config.Config) -> None:
        """原子写入；失败（权限、磁盘、路径）原样抛 OSError。"""
        gui_config.save(self._path, config)
