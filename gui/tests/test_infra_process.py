"""infra.process：短命令与可取消执行。"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.infra import process


class CommandResultTest(unittest.TestCase):
    def test_ok_only_for_zero(self) -> None:
        self.assertTrue(process.CommandResult(("info",), 0, "", "").ok)
        self.assertFalse(process.CommandResult(("info",), 3, "", "").ok)

    def test_binary_name_and_in(self) -> None:
        self.assertEqual(
            process.binary_in("/opt/chat-deepseek").name,
            process.binary_name(),
        )
        self.assertEqual(
            process.binary_in("~"), Path.home() / process.binary_name()
        )

    def test_find_binary_returns_a_path(self) -> None:
        found = process.find_binary()
        self.assertIsInstance(found, str)
        self.assertEqual(Path(found).name, process.binary_name())
        self.assertTrue(Path(found).parent.is_absolute())


@unittest.skipUnless(os.name == "posix", "需要 /bin/sh")
class RunCommandTest(unittest.TestCase):
    def test_success(self) -> None:
        result = process.run_command("/bin/sh", ["-c", "printf hello"])
        self.assertEqual(result.code, 0)
        self.assertEqual(result.stdout, "hello")
        self.assertEqual(result.stderr, "")
        self.assertTrue(result.ok)

    def test_stdin(self) -> None:
        result = process.run_command(
            "/bin/sh", ["-c", "cat"], stdin_text="p@ss 秘密\n"
        )
        self.assertEqual(result.stdout, "p@ss 秘密\n")

    def test_nonzero_and_stderr(self) -> None:
        result = process.run_command(
            "/bin/sh", ["-c", "printf bad >&2; exit 3"]
        )
        self.assertEqual(result.code, 3)
        self.assertEqual(result.stderr, "bad")
        self.assertFalse(result.ok)

    def test_invalid_utf8_is_replaced(self) -> None:
        result = process.run_command("/bin/sh", ["-c", "printf '\\377'"])
        self.assertEqual(result.stdout, "\ufffd")

    def test_timeout_raises(self) -> None:
        with self.assertRaises(subprocess.TimeoutExpired):
            process.run_command("/bin/sh", ["-c", "sleep 3"], timeout=0.2)

    def test_missing_binary_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            process.run_command("/nonexistent/chat-deepseek", ["info"])


class _Cancel:
    def __init__(self) -> None:
        self.cancelled = False

    def cancel(self) -> None:
        self.cancelled = True


@unittest.skipUnless(os.name == "posix", "需要 /bin/sh")
class RunPopenTest(unittest.TestCase):
    def test_success_keeps_args_without_binary(self) -> None:
        result = process.run_popen(
            ("/bin/sh", "-c", "printf '%s\\n' \"$@\"", "sh", "a b", "中文"),
            None,
            5,
        )
        self.assertEqual(result.code, 0)
        self.assertEqual(result.stdout.splitlines(), ["a b", "中文"])
        self.assertEqual(result.args, ("-c", "printf '%s\\n' \"$@\"", "sh", "a b", "中文"))

    def test_stdin(self) -> None:
        result = process.run_popen(("/bin/sh", "-c", "cat"), "p@ss\n", 5)
        self.assertEqual(result.code, 0)
        self.assertEqual(result.stdout, "p@ss\n")

    def test_large_output_does_not_deadlock(self) -> None:
        result = process.run_popen(
            (sys.executable, "-c", "print('x' * 200000)"), None, 20
        )
        self.assertEqual(result.code, 0)
        self.assertEqual(len(result.stdout), 200001)

    def test_timeout_terminates_and_reports(self) -> None:
        result = process.run_popen(
            ("/bin/sh", "-c", "echo $$; exec sleep 30"), None, 0.3
        )
        self.assertEqual(result.code, 1)
        self.assertTrue(result.stderr.startswith(process.TIMEOUT_STDERR))
        pid = int(result.stdout.strip())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_pre_cancelled(self) -> None:
        cancel = _Cancel()
        cancel.cancel()
        result = process.run_popen(
            ("/bin/sh", "-c", "exit 0"), None, 5, cancel
        )
        self.assertEqual(result.code, 1)
        self.assertTrue(result.stderr.startswith(process.CANCELLED_STDERR))

    def test_cancel_while_running(self) -> None:
        cancel = _Cancel()
        timer = threading.Timer(0.15, cancel.cancel)
        timer.start()
        try:
            started = time.monotonic()
            result = process.run_popen(
                ("/bin/sh", "-c", "exec sleep 30"), None, 30, cancel
            )
        finally:
            timer.cancel()
        self.assertEqual(result.code, 1)
        self.assertTrue(result.stderr.startswith(process.CANCELLED_STDERR))
        self.assertLess(time.monotonic() - started, 5)

    def test_missing_binary_is_127(self) -> None:
        result = process.run_popen(("/nonexistent/chat-deepseek", "info"), None, 5)
        self.assertEqual(result.code, 127)
        self.assertIn("/nonexistent/chat-deepseek", result.stderr)

    def test_non_executable_is_os_error(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "chat-deepseek"
            path.write_text("#!/bin/sh\n", encoding="utf-8")
            path.chmod(0o644)
            result = process.run_popen((str(path), "info"), None, 5)
        self.assertEqual(result.code, 1)
        self.assertIn("无法启动", result.stderr)


if __name__ == "__main__":
    unittest.main()
