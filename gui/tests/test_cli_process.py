"""ServerProcess：长进程的 PID 标记行不能进界面日志。"""

from __future__ import annotations

import os
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.infra import serve as cli


@unittest.skipUnless(os.name == "posix", "需要 /bin/sh")
class MarkerTest(unittest.TestCase):
    def _run(self, script: str, marker: str | None) -> cli.ServerProcess:
        lines: list[str] = []
        codes: list[int] = []
        process = cli.ServerProcess(
            ["/bin/sh", "-c", script],
            on_line=lines.append,
            on_exit=codes.append,
            marker=marker,
        )
        process.start()
        deadline = time.monotonic() + 10
        while process.running and time.monotonic() < deadline:
            time.sleep(0.02)
        # 退出回调在 pump 线程里，等它把 on_exit 也跑完。
        deadline = time.monotonic() + 5
        while not codes and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertEqual(codes, [0])
        if marker is None:
            self.assertEqual(lines, ["__CD_SERVE_PID__42", "listening"])
        else:
            self.assertEqual(lines, ["listening"])
        return process

    def test_marker_pid_is_captured_and_hidden(self) -> None:
        process = self._run(
            "printf '__CD_SERVE_PID__42\\n'; echo listening",
            marker="__CD_SERVE_PID__",
        )
        self.assertEqual(process.marker_pid, 42)

    def test_without_marker_line_is_forwarded(self) -> None:
        process = self._run(
            "printf '__CD_SERVE_PID__42\\n'; echo listening", marker=None
        )
        self.assertIsNone(process.marker_pid)


if __name__ == "__main__":
    unittest.main()
