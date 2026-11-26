"""SSH 常驻管理通道。

GUI 用 `ssh -T <host> 'exec /bin/sh'` 拉起一个常驻 POSIX shell，每条
`chat-deepseek` 命令都作为这个 shell 的子进程执行。CLI 的登录态按“发起 login
的宿主进程”保存，所以只要通道不断，login 之后的 whoami / user ... / backup ...
都共享同一个登录态：不需要改 CLI，也不用每条命令重新登录。

每条命令末尾追加一行哨兵打印退出码；需要 stdin 的命令（密码）走 here-doc。
shell 会预读自己的 stdin，直接把密码行写进通道会被 shell 当成下一条命令吃掉。

只支持密钥/agent 认证：ssh 用 BatchMode 启动，不会在 GUI 里等密码输入。
"""

from __future__ import annotations

import queue
import shlex
import subprocess
import threading
import time
from typing import Sequence

from .process import CommandResult

SSH_PROGRAM = "ssh"
REMOTE_SHELL = "exec /bin/sh"
REMOTE_BINARY = "chat-deepseek"
TRANSPORT_EXIT = 255
# 远端前台 serve 启动时先打印一行 PID，停止时按它发 SIGTERM。
# `ssh -T` 不分配 pty，客户端断开时 sshd 不会给远端命令发 SIGHUP；只结束本地
# ssh 会在远端留下继续占端口的孤儿进程。
SERVE_PID_PREFIX = "__CD_SERVE_PID__"
DEFAULT_TIMEOUT = 120.0
CONNECT_TIMEOUT = 20.0
# 远端 stderr 和 stdout 是两条独立管道；哨兵到达后稍等一下，让 stderr 追上来。
STDERR_QUIET = 0.04
STDERR_MAX_WAIT = 0.3


def default_options() -> list[str]:
    """在尊重用户 ssh_config 的前提下，避免交互提示和永久挂起。"""
    return [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=4",
    ]


def ssh_command(
    host: str,
    remote: str | None = None,
    *,
    program: str = SSH_PROGRAM,
    options: Sequence[str] | None = None,
) -> list[str]:
    """拼出 ssh 命令行；remote 为远端命令字符串。"""
    command = [program, "-T"]
    command.extend(default_options() if options is None else options)
    command.append(host)
    if remote is not None:
        command.append(remote)
    return command


def serve_command(
    host: str,
    remote: str,
    *,
    program: str = SSH_PROGRAM,
    options: Sequence[str] | None = None,
) -> list[str]:
    """拼出远端前台 serve 的 ssh 命令，并让它先报出远端 PID。

    整段包在 `/bin/sh -c` 里：远端登录 shell 可能是 fish/csh，`$$` 和 `printf`
    语义不一样。打印完 PID 用 `exec` 换成真正的进程，PID 保持不变。
    """
    script = f"printf '{SERVE_PID_PREFIX}%s\\n' \"$$\"; exec {remote}"
    command = f"exec /bin/sh -c {shlex.quote(script)}"
    return ssh_command(host, command, program=program, options=options)


def remote_binary(binary_dir: str) -> str:
    """把设置里的远端目录换算成可执行文件路径。

    远端固定用 `chat-deepseek`（不按 GUI 所在平台加 .exe）。设置项就是目录；
    远端路径拼装不能走 pathlib，Windows 上 Path 会给出反斜杠。
    """
    value = binary_dir.strip()
    if not value:
        raise RuntimeError("请先在设置里填写远端二进制目录")
    return value.rstrip("/") + "/" + REMOTE_BINARY


class SshSession:
    """一个常驻 SSH shell，串行执行命令并保留 CLI 登录态。"""

    def __init__(
        self,
        host: str,
        *,
        program: str = SSH_PROGRAM,
        options: Sequence[str] | None = None,
        env: dict[str, str] | None = None,
        connect_timeout: float = CONNECT_TIMEOUT,
        command_timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.host = host.strip()
        self.program = program
        self.options = list(default_options() if options is None else options)
        self.env = env
        self.connect_timeout = connect_timeout
        self.command_timeout = command_timeout
        self.remote_user = ""
        self._process: subprocess.Popen[str] | None = None
        self._stdout: queue.Queue[str | None] | None = None
        self._stderr_text = ""
        self._stderr_stamp = 0.0
        self._stderr_lock = threading.Lock()
        self._lock = threading.RLock()
        self._counter = 0
        self._threads: list[threading.Thread] = []

    @property
    def connected(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def ensure_started(self) -> None:
        """建立常驻通道并完成 handshake（printf ready + id -un）。

        只是把内部的握手暴露出来，不改变既有的命令执行路径；失败抛
        RuntimeError，消息可直接展示（例如无法启动 ssh、无法启动 /bin/sh）。
        """
        with self._lock:
            error = self._ensure_started()
        if error:
            raise RuntimeError(error)

    def run(
        self,
        binary: str,
        args: Sequence[str],
        stdin_text: str | None = None,
        timeout: float | None = None,
    ) -> CommandResult:
        """执行一条 CLI 命令；参数与 `cli.run_command` 保持一致。

        连接失败、超时和断线统一返回 255；调用方据此区分 ssh 问题和 CLI 的
        0/1/2/3/4 退出码。
        """
        limit = self.command_timeout if timeout is None else timeout
        argv = [binary, *args]
        with self._lock:
            error = self._ensure_started()
            if error:
                return CommandResult(tuple(args), TRANSPORT_EXIT, "", error)
            return self._exchange(tuple(args), argv, stdin_text, limit)

    def close(self) -> None:
        """先让远端 shell 退出，再兜底终止 ssh。"""
        with self._lock:
            process = self._process
            if process is None:
                return
            try:
                if process.stdin is not None:
                    process.stdin.write("exit\n")
                    process.stdin.flush()
            except (OSError, ValueError):
                pass
            try:
                process.wait(timeout=1.0)
            except subprocess.TimeoutExpired:
                pass
            self._close_process()

    # ---- 内部 ---------------------------------------------------------

    def _ensure_started(self) -> str:
        if self.connected:
            return ""
        self._close_process()
        if not self.host:
            return "没有配置 SSH 主机"
        command = ssh_command(
            self.host,
            REMOTE_SHELL,
            program=self.program,
            options=self.options,
        )
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=self.env,
            )
        except OSError as exc:
            return f"无法启动 {command[0]}：{exc}"
        self._process = process
        self._stdout = queue.Queue()
        self._stderr_text = ""
        self._stderr_stamp = time.monotonic()
        self._threads = [
            threading.Thread(
                target=self._pump_stdout,
                args=(process.stdout, self._stdout),
                daemon=True,
            ),
            threading.Thread(
                target=self._pump_stderr,
                args=(process.stderr,),
                daemon=True,
            ),
        ]
        for thread in self._threads:
            thread.start()

        probe = self._exchange(("printf",), ["printf", "ready"], None, self.connect_timeout)
        if probe.code != 0 or probe.stdout.strip() != "ready":
            self._close_process()
            detail = probe.stderr.strip()
            return detail or f"无法在 {self.host} 上启动 /bin/sh"
        who = self._exchange(("id", "-un"), ["id", "-un"], None, 5.0)
        self.remote_user = who.stdout.strip() if who.ok else ""
        return ""

    def _exchange(
        self,
        args: tuple[str, ...],
        argv: Sequence[str],
        stdin_text: str | None,
        timeout: float,
    ) -> CommandResult:
        process = self._process
        out_queue = self._stdout
        if process is None or process.stdin is None or out_queue is None:
            return CommandResult(args, TRANSPORT_EXIT, "", "SSH 连接尚未建立")
        token = self._next_token()
        script = self._script(argv, stdin_text, token)
        with self._stderr_lock:
            offset = len(self._stderr_text)
        try:
            process.stdin.write(script)
            process.stdin.flush()
        except (OSError, ValueError):
            self._close_process()
            return CommandResult(args, TRANSPORT_EXIT, "", "SSH 连接已断开")

        marker = f"__CD_RC_{token}__"
        lines: list[str] = []
        deadline = time.monotonic() + max(1.0, timeout)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                stderr = self._take_stderr(offset)
                self._close_process()
                return CommandResult(
                    args,
                    TRANSPORT_EXIT,
                    "".join(lines),
                    _join("命令超时，SSH 通道已关闭", stderr),
                )
            try:
                line = out_queue.get(timeout=remaining)
            except queue.Empty:
                continue
            if line is None:
                stderr = self._take_stderr(offset)
                self._close_process()
                return CommandResult(
                    args,
                    TRANSPORT_EXIT,
                    "".join(lines),
                    _join("SSH 连接已断开", stderr),
                )
            if line.startswith(marker):
                text = "".join(lines)
                # 哨兵前主动补了一个换行；去掉它才能还原命令的原始输出。
                if text.endswith("\n"):
                    text = text[:-1]
                try:
                    code = int(line[len(marker) :].strip())
                except ValueError:
                    code = 1
                return CommandResult(args, code, text, self._take_stderr(offset))
            lines.append(line)

    def _script(
        self, argv: Sequence[str], stdin_text: str | None, token: int
    ) -> str:
        line = shlex.join(argv)
        if stdin_text is None:
            body = f"{line} < /dev/null\n"
        else:
            delimiter = f"__CD_EOF_{token}__"
            text = stdin_text if stdin_text.endswith("\n") else stdin_text + "\n"
            while f"\n{delimiter}\n" in f"\n{text}":
                delimiter += "_"
            body = f"{line} <<'{delimiter}'\n{text}{delimiter}\n"
        return body + f"printf '\\n__CD_RC_{token}__%d\\n' \"$?\"\n"

    def _next_token(self) -> int:
        self._counter += 1
        return self._counter

    def _take_stderr(self, offset: int) -> str:
        deadline = time.monotonic() + STDERR_MAX_WAIT
        while time.monotonic() < deadline:
            with self._stderr_lock:
                text = self._stderr_text
                stamp = self._stderr_stamp
            if len(text) <= offset:
                break
            if time.monotonic() - stamp >= STDERR_QUIET:
                break
            time.sleep(0.01)
        with self._stderr_lock:
            return self._stderr_text[offset:]

    def _pump_stdout(
        self, stream, target: queue.Queue[str | None]
    ) -> None:
        try:
            for line in stream:
                target.put(line)
        except (OSError, ValueError):
            pass
        finally:
            target.put(None)

    def _pump_stderr(self, stream) -> None:
        try:
            for line in stream:
                with self._stderr_lock:
                    self._stderr_text += line
                    self._stderr_stamp = time.monotonic()
        except (OSError, ValueError):
            pass

    def _close_process(self) -> None:
        process = self._process
        self._process = None
        self._stdout = None
        if process is None:
            return
        for stream in (process.stdin,):
            try:
                if stream is not None:
                    stream.close()
            except OSError:
                pass
        try:
            process.terminate()
        except OSError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            except OSError:
                pass
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
        for stream in (process.stdout, process.stderr):
            try:
                if stream is not None:
                    stream.close()
            except OSError:
                pass
        for thread in self._threads:
            thread.join(timeout=0.5)
        self._threads = []


def _join(first: str, second: str) -> str:
    parts = [part.strip() for part in (first, second) if part.strip()]
    return "\n".join(parts)
