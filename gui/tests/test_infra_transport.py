"""infra.transport：本机与 fake ssh 两种执行通道。"""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.domain import commands
from cdgui.domain.commands import CommandSpec
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.infra import errors
from cdgui.infra.ssh import TRANSPORT_EXIT
from cdgui.infra.transport import LocalTransport, SshTransport

FAKE_SSH = """#!/bin/sh
for last in "$@"; do :; done
exec /bin/sh -c "$last"
"""

FAKE_CLI = """#!/bin/sh
case "$1" in
  info)
    if [ -n "$CD_CRASH" ]; then kill -9 "$PPID"; fi
    printf 'version=test\\nos=linux\\n'
    ;;
  args)
    printf '%s\\n' "$@"
    ;;
  stdin)
    cat > "$CD_STDIN_FILE"
    ;;
  login)
    cat > "$CD_STDIN_FILE"
    printf '%s' "$PPID" > "$CD_STATE_FILE"
    printf 'ok\\n'
    ;;
  whoami)
    if [ "$(cat "$CD_STATE_FILE" 2>/dev/null)" = "$PPID" ]; then
      printf 'same-shell\\n'
    else
      exit 3
    fi
    ;;
  fail)
    printf 'bad thing\\n' >&2
    exit 3
    ;;
  hang)
    exec sleep 1
    ;;
  serve)
    printf '正在监听 127.0.0.1:8090\\n'
    exec sleep 30
    ;;
  kill)
    printf '%s\\n' "$2" > "$CD_KILL_FILE"
    kill -TERM "$2" 2>/dev/null
    ;;
  *)
    printf 'unknown: %s\\n' "$1" >&2
    exit 2
    ;;
esac
"""


def wait_until(predicate, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("等待条件超时")


def local_target(root: Path) -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir=str(root),
            data_dir=str(root / "data"),
        ),
        binary=str(root / "chat-deepseek"),
        data_dir=str(root / "data"),
    )


def remote_target(root: Path, binary: str | None = None) -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.SSH,
            host="fake",
            binary_dir=str(root),
            data_dir="",
        ),
        binary=binary or str(root / "chat-deepseek"),
        data_dir="",
    )


class _Scripts(unittest.TestCase):
    """建一个临时目录，放 fake CLI（本机/远端共用）。"""

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binary = self.root / "chat-deepseek"
        self.binary.write_text(FAKE_CLI, encoding="utf-8")
        self.binary.chmod(0o755)
        self.stdin_file = self.root / "stdin.txt"
        self.state_file = self.root / "state.txt"


@unittest.skipUnless(os.name == "posix", "需要 /bin/sh")
class LocalTransportTest(_Scripts):
    def setUp(self) -> None:
        super().setUp()
        self.transport = LocalTransport(local_target(self.root))
        self.addCleanup(self.transport.close)

    def test_run_returns_result(self) -> None:
        result = self.transport.run(CommandSpec(("args", "a b", "中文")))
        self.assertEqual(result.code, 0)
        self.assertEqual(result.stdout.splitlines(), ["args", "a b", "中文"])
        self.assertEqual(result.args, ("args", "a b", "中文"))

    def test_run_passes_stdin(self) -> None:
        os.environ["CD_STDIN_FILE"] = str(self.stdin_file)
        self.addCleanup(os.environ.pop, "CD_STDIN_FILE", None)
        result = self.transport.run(
            CommandSpec(("stdin",), stdin="p@ss 秘密\n")
        )
        self.assertEqual(result.code, 0)
        self.assertEqual(
            self.stdin_file.read_text(encoding="utf-8"), "p@ss 秘密\n"
        )

    def test_timeout_is_normalized(self) -> None:
        result = self.transport.run(CommandSpec(("hang",), timeout=0.2))
        self.assertEqual(result.code, 1)
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result, target=self.transport.target)
        self.assertIs(caught.exception.kind, errors.ErrorKind.TIMEOUT)

    def test_pre_cancelled_is_normalized(self) -> None:
        class Token:
            cancelled = True

        result = self.transport.run(CommandSpec(("args", "x")), Token())
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result, target=self.transport.target)
        self.assertIs(caught.exception.kind, errors.ErrorKind.CANCELLED)

    def test_missing_binary_is_127(self) -> None:
        missing = LocalTransport(
            Target(
                endpoint=Endpoint(
                    kind=ConnectionKind.LOCAL,
                    binary_dir=str(self.root),
                    data_dir=str(self.root),
                ),
                binary=str(self.root / "nope"),
                data_dir=str(self.root),
            )
        )
        result = missing.run(CommandSpec(("info",)))
        self.assertEqual(result.code, 127)
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result, target=missing.target)
        self.assertIs(caught.exception.kind, errors.ErrorKind.MISSING_BINARY)

    def test_verify_checks_binary(self) -> None:
        self.transport.verify()
        missing = LocalTransport(
            Target(
                endpoint=Endpoint(kind=ConnectionKind.LOCAL, binary_dir="/opt"),
                binary=str(self.root / "nope"),
                data_dir=str(self.root),
            )
        )
        with self.assertRaises(errors.CommandError) as caught:
            missing.verify()
        self.assertIs(caught.exception.kind, errors.ErrorKind.MISSING_BINARY)

    def test_open_serve_streams_lines_and_stops(self) -> None:
        lines: list[str] = []
        codes: list[int] = []
        handle = self.transport.open_serve(
            commands.serve(self.transport.target),
            on_line=lines.append,
            on_exit=codes.append,
        )
        self.addCleanup(lambda: handle.stop(wait=True, timeout=2))
        wait_until(lambda: lines)
        self.assertIn("正在监听", lines[0])
        self.assertTrue(handle.running)
        self.assertIsNone(handle.marker_pid)
        handle.stop(wait=True, timeout=3)
        wait_until(lambda: codes)
        self.assertEqual(len(codes), 1)
        self.assertFalse(handle.running)

    def test_close_is_idempotent(self) -> None:
        self.transport.close()
        self.transport.close()


@unittest.skipUnless(os.name == "posix", "需要 /bin/sh")
class SshTransportTest(_Scripts):
    def setUp(self) -> None:
        super().setUp()
        fake_ssh = self.root / "ssh"
        fake_ssh.write_text(FAKE_SSH, encoding="utf-8")
        fake_ssh.chmod(0o755)
        self.env = dict(os.environ)
        self.env["PATH"] = str(self.root) + os.pathsep + self.env.get("PATH", "")
        self.env["CD_STDIN_FILE"] = str(self.stdin_file)
        self.env["CD_STATE_FILE"] = str(self.state_file)
        self.transport = SshTransport(
            remote_target(self.root), env=self.env
        )
        self.addCleanup(self.transport.close)
        self.handles: list[object] = []
        self.addCleanup(self._cleanup_handles)

    def _cleanup_handles(self) -> None:
        for handle in self.handles:
            handle.stop(wait=True, timeout=2)

    def test_run_uses_resident_shell(self) -> None:
        result = self.transport.run(CommandSpec(("args", "a b", "中文")))
        self.assertEqual(result.code, 0)
        self.assertEqual(result.stdout.splitlines(), ["args", "a b", "中文"])
        self.assertTrue(self.transport.connected)
        self.assertTrue(self.transport.remote_user)

    def test_verify_handshakes_only(self) -> None:
        self.transport.verify()
        self.assertTrue(self.transport.connected)
        self.assertTrue(self.transport.remote_user)

    def test_verify_spawn_failure_is_transport(self) -> None:
        transport = SshTransport(
            remote_target(self.root),
            program=str(self.root / "nope"),
            env=self.env,
        )
        self.addCleanup(transport.close)
        with self.assertRaises(errors.CommandError) as caught:
            transport.verify()
        self.assertIs(caught.exception.kind, errors.ErrorKind.TRANSPORT)
        self.assertIn("SSH 连接失败", caught.exception.failure.title)

    def test_timeout_closes_channel_and_is_255(self) -> None:
        result = self.transport.run(CommandSpec(("hang",), timeout=0.3))
        self.assertEqual(result.code, TRANSPORT_EXIT)
        self.assertFalse(self.transport.connected)
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result, target=self.transport.target)
        self.assertIs(caught.exception.kind, errors.ErrorKind.TRANSPORT)

    def test_pre_cancelled_does_not_start_command(self) -> None:
        class Token:
            cancelled = True

        result = self.transport.run(CommandSpec(("args", "x")), Token())
        self.assertEqual(result.code, 1)
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result, target=self.transport.target)
        self.assertIs(caught.exception.kind, errors.ErrorKind.CANCELLED)

    def test_open_serve_prints_pid_and_stops_by_pid(self) -> None:
        lines: list[str] = []
        codes: list[int] = []
        handle = self.transport.open_serve(
            commands.serve(self.transport.target),
            on_line=lines.append,
            on_exit=codes.append,
        )
        self.handles.append(handle)
        wait_until(lambda: handle.marker_pid is not None and lines)
        self.assertIsNotNone(handle.marker_pid)
        self.assertIn("正在监听", lines[0])
        pid = handle.marker_pid
        handle.stop(wait=True, timeout=5)
        wait_until(lambda: not handle.running)
        wait_until(lambda: codes)
        # 远端 serve 被 SIGTERM 结束：PID 已经不存在，而不是只杀了本地 ssh。
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_close_is_idempotent(self) -> None:
        self.transport.verify()
        self.transport.close()
        self.transport.close()
        self.assertFalse(self.transport.connected)


if __name__ == "__main__":
    unittest.main()
