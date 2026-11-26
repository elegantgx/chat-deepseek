"""本机子进程执行。

从 `gui/cli.py` 原样搬来的短命令封装（行为不变），另外给 LocalTransport 增加
可取消的执行入口 `run_popen`。`run_popen` 把子进程的 stdout/stderr 重定向到
临时文件，而不是管道：这样轮询超时/取消时不会被 64KB 管道缓冲卡住，也不需要
在进程层再起线程（线程只允许出现在 runner / serve / ssh）。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence

# 超时/取消不是 CLI 的退出码，但 CommandResult 只有 code 一个状态字段，所以用
# 固定的说明文字区分；errors.normalize 依赖这两行判断 TIMEOUT / CANCELLED。
TIMEOUT_STDERR = "命令执行超时，已终止"
CANCELLED_STDERR = "命令已取消"

# 轮询间隔：足够短，用户点取消后 20ms 内就能 terminate。
POLL_INTERVAL = 0.02
# terminate 之后留给子进程退出的时间，超时再 kill。
TERMINATE_TIMEOUT = 2.0


class CancelCheck(Protocol):
    """`run_popen` 只需要观察取消标志；runner.CancelToken 满足这个形状。"""

    @property
    def cancelled(self) -> bool: ...


@dataclass(frozen=True)
class CommandResult:
    args: tuple[str, ...]
    code: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.code == 0


def binary_name() -> str:
    return "chat-deepseek.exe" if os.name == "nt" else "chat-deepseek"


def binary_in(directory: str | os.PathLike[str]) -> Path:
    return Path(directory).expanduser() / binary_name()


def find_binary() -> str:
    """优先找仓库根目录的 chat-deepseek，其次找 PATH。"""
    name = binary_name()
    if getattr(sys, "frozen", False):
        # PyInstaller 包内 __file__ 在临时解压目录；发布包里的 CLI 与 GUI 同级。
        # macOS 的 GUI 在 .app 内，CLI 仍在 .app 的上一层目录。
        executable = Path(sys.executable)
        directories = [executable.parent]
        if sys.platform == "darwin" and len(executable.parents) > 3:
            directories.append(executable.parents[3])
        for directory in directories:
            candidate = directory / name
            if candidate.is_file():
                return str(candidate)
    # 原实现里 here 是 gui/；这里是 gui/cdgui/infra/，先退回 gui/ 再找仓库根。
    here = Path(__file__).resolve().parents[2]
    for candidate in (here.parent / name, here.parent / "chat-deepseek"):
        if candidate.is_file():
            return str(candidate)
    found = shutil.which("chat-deepseek")
    return found or str(here.parent / name)


def run_command(
    binary: str,
    args: Sequence[str],
    stdin_text: str | None = None,
    timeout: float | None = None,
) -> CommandResult:
    """执行一次短命令并收集输出；serve 不走这里。"""
    kwargs: dict[str, object] = {
        "text": True,
        "capture_output": True,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if timeout is not None:
        kwargs["timeout"] = timeout
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    if stdin_text is None:
        kwargs["stdin"] = subprocess.DEVNULL
    else:
        kwargs["input"] = stdin_text
    completed = subprocess.run([binary, *args], **kwargs)
    return CommandResult(
        args=tuple(args),
        code=completed.returncode,
        stdout=completed.stdout or "",
        stderr=completed.stderr or "",
    )


def run_popen(
    argv: Sequence[str],
    stdin: str | None,
    timeout: float | None,
    cancel: CancelCheck | None = None,
) -> CommandResult:
    """执行一条可取消的命令，返回与 `run_command` 相同形状的结果。

    `argv` 是完整命令行（argv[0] 是可执行文件）；结果里的 `args` 是与
    `run_command` 一致的“不含可执行文件”的参数元组。超时或取消时 terminate
    （必要时 kill），返回退出码 1 和固定说明，调用方据此归类 TIMEOUT/CANCELLED。
    """
    args = tuple(argv[1:])
    # 预取消不应再启动子进程：否则像 `exit 0` 这样的命令可能先结束，
    # 轮询来不及看到取消标志，调用方会拿到成功的假象。
    if cancel is not None and cancel.cancelled:
        return CommandResult(args, 1, "", CANCELLED_STDERR)
    try:
        process, stdout_file, stderr_file, stdin_file = _spawn(argv, stdin)
    except FileNotFoundError as exc:
        return CommandResult(args, 127, "", f"找不到可执行文件：{argv[0]}（{exc}）")
    except OSError as exc:
        return CommandResult(args, 1, "", f"无法启动 {argv[0]}：{exc}")

    outcome = _wait(process, timeout, cancel)
    stdout = _read(stdout_file)
    stderr = _read(stderr_file)
    _close_files(stdout_file, stderr_file, stdin_file)

    code = 0 if process.returncode is None else process.returncode
    if outcome == "cancelled":
        return CommandResult(args, 1, stdout, _join(CANCELLED_STDERR, stderr))
    if outcome == "timeout":
        return CommandResult(args, 1, stdout, _join(TIMEOUT_STDERR, stderr))
    return CommandResult(args, code, stdout, stderr)


# ---- 内部 -------------------------------------------------------------


def _spawn(
    argv: Sequence[str], stdin: str | None
) -> tuple[subprocess.Popen[bytes], object, object, object | None]:
    """用临时文件承载三条标准流，避免管道缓冲导致轮询假死。

    返回 (process, stdout_file, stderr_file, stdin_file)；文件由调用方读取后关闭。
    """
    stdout_file = tempfile.TemporaryFile(mode="w+b")
    stderr_file = tempfile.TemporaryFile(mode="w+b")
    if stdin is None:
        stdin_arg: object = subprocess.DEVNULL
        stdin_file = None
    else:
        stdin_file = tempfile.TemporaryFile(mode="w+b")
        stdin_file.write(stdin.encode("utf-8"))
        stdin_file.seek(0)
        stdin_arg = stdin_file
    kwargs: dict[str, object] = {
        "stdin": stdin_arg,
        "stdout": stdout_file,
        "stderr": stderr_file,
    }
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        process = subprocess.Popen(list(argv), **kwargs)
    except BaseException:
        _close_files(stdout_file, stderr_file, stdin_file)
        raise
    # Popen 已经复制了文件描述符；父进程保留到读取结束再关。
    return process, stdout_file, stderr_file, stdin_file


def _wait(
    process: subprocess.Popen[bytes],
    timeout: float | None,
    cancel: CancelCheck | None,
) -> str:
    """轮询子进程；返回 "done" / "timeout" / "cancelled"。"""
    deadline = None if timeout is None else time.monotonic() + max(0.0, timeout)
    while process.poll() is None:
        if cancel is not None and cancel.cancelled:
            _terminate(process)
            return "cancelled"
        if deadline is not None and time.monotonic() >= deadline:
            _terminate(process)
            return "timeout"
        time.sleep(POLL_INTERVAL)
    return "done"


def _terminate(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        process.terminate()
    except OSError:
        pass
    try:
        process.wait(timeout=TERMINATE_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
        except OSError:
            pass
        try:
            process.wait(timeout=TERMINATE_TIMEOUT)
        except subprocess.TimeoutExpired:
            pass


def _read(stream) -> str:
    if stream is None:
        return ""
    try:
        stream.flush()
        stream.seek(0)
        return stream.read().decode("utf-8", "replace")
    except (OSError, ValueError):
        return ""


def _close_files(*streams) -> None:
    for stream in streams:
        try:
            if stream is not None:
                stream.close()
        except OSError:
            pass


def _join(first: str, second: str) -> str:
    return "\n".join(part for part in (first, second) if part)
