"""长进程（前台 serve）管理。

从 `gui/cli.py` 搬来的 `ServerProcess`，行为不变：以 marker 开头的行是进程
自报的 PID（远端 serve 用），不交给界面；其余输出按行回调；`stop(wait,
timeout)` 先 terminate，超时再 kill。`ServeHandle` 是它对外暴露的协议名，
transport.open_serve 返回这个形状。
"""

from __future__ import annotations

import os
import subprocess
import threading
from typing import Callable, Protocol, Sequence, runtime_checkable


@runtime_checkable
class ServeHandle(Protocol):
    """transport.open_serve 的返回值；实现是 `ServerProcess`。"""

    marker_pid: int | None
    command: tuple[str, ...]

    @property
    def running(self) -> bool: ...

    def start(self) -> None: ...

    def stop(self, wait: bool = False, timeout: float = 10.0) -> None: ...


class ServerProcess:
    """持有一个长进程（serve 或 ssh + serve），把输出按行回调给界面。"""

    def __init__(
        self,
        command: Sequence[str],
        on_line: Callable[[str], None],
        on_exit: Callable[[int], None],
        marker: str | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        self.command = tuple(command)
        self.on_line = on_line
        self.on_exit = on_exit
        # 默认继承当前进程环境；SSH 通道可传入自己的 env（与 SshSession 一致）。
        self.env = env
        # 以 marker 开头的行是进程自报的 PID（远端 serve 用），不交给界面。
        self.marker = marker
        self.marker_pid: int | None = None
        self.process: subprocess.Popen[str] | None = None
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self) -> None:
        if self.running:
            return
        kwargs: dict[str, object] = {
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
            "bufsize": 1,
            "start_new_session": os.name != "nt",
            "env": self.env,
        }
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.process = subprocess.Popen(list(self.command), **kwargs)
        self._thread = threading.Thread(target=self._pump, daemon=True)
        self._thread.start()

    def _pump(self) -> None:
        process = self.process
        if process is None or process.stdout is None:
            return
        try:
            for line in process.stdout:
                line = line.rstrip("\n")
                if self.marker and line.startswith(self.marker):
                    value = line[len(self.marker) :].strip()
                    if value.isdigit():
                        self.marker_pid = int(value)
                    continue
                self.on_line(line)
        finally:
            code = process.wait()
            self.on_exit(code)

    def stop(self, wait: bool = False, timeout: float = 10.0) -> None:
        process = self.process
        if process is None or process.poll() is not None:
            return
        try:
            process.terminate()
        except OSError:
            return
        if wait:
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
