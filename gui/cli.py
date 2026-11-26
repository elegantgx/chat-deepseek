"""兼容转发壳：实现已迁到 `cdgui.infra.process` / `cdgui.infra.serve`。

C6 切换完成后删除本文件；在此之前旧 `app.py` 继续通过这些名字工作。
"""

from __future__ import annotations

from cdgui.infra.process import (
    CommandResult,
    binary_in,
    binary_name,
    find_binary,
    run_command,
)
from cdgui.infra.serve import ServerProcess

__all__ = [
    "CommandResult",
    "ServerProcess",
    "binary_in",
    "binary_name",
    "find_binary",
    "run_command",
]
