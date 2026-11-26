"""兼容转发壳：实现已迁到 `cdgui.infra.ssh`。

C6 切换完成后删除本文件；在此之前旧 `app.py` 和测试继续通过这里的名字工作。
"""

from __future__ import annotations

from cdgui.infra.ssh import (
    CONNECT_TIMEOUT,
    DEFAULT_TIMEOUT,
    REMOTE_BINARY,
    REMOTE_SHELL,
    SERVE_PID_PREFIX,
    SSH_PROGRAM,
    STDERR_MAX_WAIT,
    STDERR_QUIET,
    TRANSPORT_EXIT,
    SshSession,
    default_options,
    remote_binary,
    serve_command,
    ssh_command,
)

__all__ = [
    "CONNECT_TIMEOUT",
    "DEFAULT_TIMEOUT",
    "REMOTE_BINARY",
    "REMOTE_SHELL",
    "SERVE_PID_PREFIX",
    "SSH_PROGRAM",
    "STDERR_MAX_WAIT",
    "STDERR_QUIET",
    "TRANSPORT_EXIT",
    "SshSession",
    "default_options",
    "remote_binary",
    "serve_command",
    "ssh_command",
]
