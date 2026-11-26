from __future__ import annotations

import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.infra import ssh as ssh_session

FAKE_SSH = """#!/bin/sh
# 忽略 ssh 选项和主机名；最后一个是远端命令，和真实 ssh 一样交给登录 shell。
for last in "$@"; do :; done
exec /bin/sh -c "$last"
"""

FAKE_CLI = """#!/bin/sh
case "$1" in
  info)
    printf 'version=test\\nos=linux\\n'
    ;;
  fail)
    printf 'bad thing\\n' >&2
    exit 3
    ;;
  stdin)
    cat > "$CD_STDIN_FILE"
    ;;
  args)
    printf '%s\\n' "$@"
    ;;
  login)
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
  crash)
    kill -9 "$PPID"
    ;;
  hang)
    sleep 5
    ;;
  *)
    printf 'unknown: %s\\n' "$1" >&2
    exit 2
    ;;
esac
"""


@unittest.skipUnless(os.name == "posix", "常驻通道测试需要 /bin/sh")
class SshSessionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.binary = str(root / "chat-deepseek")
        (root / "chat-deepseek").write_text(FAKE_CLI, encoding="utf-8")
        (root / "ssh").write_text(FAKE_SSH, encoding="utf-8")
        (root / "chat-deepseek").chmod(0o755)
        (root / "ssh").chmod(0o755)
        self.stdin_file = root / "stdin.txt"
        self.state_file = root / "state.txt"
        self.env = dict(os.environ)
        self.env["PATH"] = str(root) + os.pathsep + self.env.get("PATH", "")
        self.env["CD_STDIN_FILE"] = str(self.stdin_file)
        self.env["CD_STATE_FILE"] = str(self.state_file)
        self.session = ssh_session.SshSession("fake", env=self.env)

    def tearDown(self) -> None:
        self.session.close()
        self.temp.cleanup()

    def test_runs_commands_on_one_channel(self) -> None:
        result = self.session.run(self.binary, ["info"])
        self.assertEqual(result.code, 0)
        self.assertEqual(result.stdout, "version=test\nos=linux\n")
        self.assertEqual(result.stderr, "")
        self.assertEqual(result.args, ("info",))

    def test_keeps_stderr_separate(self) -> None:
        result = self.session.run(self.binary, ["fail"])
        self.assertEqual(result.code, 3)
        self.assertEqual(result.stdout, "")
        self.assertIn("bad thing", result.stderr)

    def test_stdin_uses_here_doc(self) -> None:
        result = self.session.run(
            self.binary, ["stdin"], stdin_text="p@ss 秘密\n"
        )
        self.assertEqual(result.code, 0)
        self.assertEqual(
            self.stdin_file.read_text(encoding="utf-8"), "p@ss 秘密\n"
        )

    def test_quotes_arguments(self) -> None:
        result = self.session.run(
            self.binary, ["args", "a b", "中文", "'quote'"]
        )
        self.assertEqual(result.code, 0)
        self.assertEqual(
            result.stdout.splitlines(),
            ["args", "a b", "中文", "'quote'"],
        )

    def test_login_state_survives_between_commands(self) -> None:
        login = self.session.run(self.binary, ["login"])
        self.assertEqual(login.code, 0)
        whoami = self.session.run(self.binary, ["whoami"])
        self.assertEqual(whoami.code, 0)
        self.assertEqual(whoami.stdout, "same-shell\n")

        # 关掉通道等于换了一个 shell，登录态也跟着失效。
        self.session.close()
        expired = self.session.run(self.binary, ["whoami"])
        self.assertEqual(expired.code, 3)

    def test_channel_death_is_reported_and_reconnects(self) -> None:
        result = self.session.run(self.binary, ["crash"])
        self.assertEqual(result.code, ssh_session.TRANSPORT_EXIT)
        self.assertIn("SSH 连接已断开", result.stderr)
        self.assertFalse(self.session.connected)

        again = self.session.run(self.binary, ["info"])
        self.assertEqual(again.code, 0)
        self.assertIn("version=test", again.stdout)

    def test_timeout_closes_channel(self) -> None:
        result = self.session.run(self.binary, ["hang"], timeout=0.3)
        self.assertEqual(result.code, ssh_session.TRANSPORT_EXIT)
        self.assertIn("超时", result.stderr)
        self.assertFalse(self.session.connected)

    def test_missing_binary_reports_127(self) -> None:
        result = self.session.run("/nonexistent/chat-deepseek", ["info"])
        self.assertEqual(result.code, 127)
        self.assertIn("not found", result.stderr)

    def test_spawn_failure_is_transport_error(self) -> None:
        session = ssh_session.SshSession("fake", program="/nonexistent/ssh")
        try:
            result = session.run(self.binary, ["info"])
        finally:
            session.close()
        self.assertEqual(result.code, ssh_session.TRANSPORT_EXIT)
        self.assertIn("无法启动", result.stderr)


class HelperTest(unittest.TestCase):
    def test_remote_binary_joins_directory(self) -> None:
        self.assertEqual(
            ssh_session.remote_binary("/volume1/chat-deepseek"),
            "/volume1/chat-deepseek/chat-deepseek",
        )
        self.assertEqual(
            ssh_session.remote_binary("/volume1/chat-deepseek/"),
            "/volume1/chat-deepseek/chat-deepseek",
        )
        self.assertEqual(
            ssh_session.remote_binary("/"),
            "/chat-deepseek",
        )

    def test_remote_binary_requires_directory(self) -> None:
        with self.assertRaises(RuntimeError):
            ssh_session.remote_binary("  ")

    def test_serve_command_reports_pid(self) -> None:
        command = ssh_session.serve_command(
            "nas", "'/srv/chat-deepseek' serve --no-browser"
        )
        self.assertEqual(command[0], "ssh")
        self.assertEqual(command[-2], "nas")
        script = command[-1]
        # 整段包在 /bin/sh -c 里：远端登录 shell 可能是 fish/csh。
        self.assertTrue(script.startswith("exec /bin/sh -c "))
        self.assertIn(ssh_session.SERVE_PID_PREFIX, script)
        # 内层命令被 shlex 转义，这里只确认远端命令和 exec 都在。
        self.assertIn("/srv/chat-deepseek", script)
        self.assertIn("serve --no-browser", script)
        self.assertIn("exec ", script)

    @unittest.skipUnless(os.name == "posix", "需要 /bin/sh")
    def test_serve_command_prints_pid_then_execs(self) -> None:
        remote = shlex.join(["/bin/sh", "-c", "echo remote-started"])
        command = ssh_session.serve_command("nas", remote)
        finished = subprocess.run(
            ["/bin/sh", "-c", command[-1]],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(finished.returncode, 0)
        lines = finished.stdout.splitlines()
        self.assertTrue(lines[0].startswith(ssh_session.SERVE_PID_PREFIX))
        self.assertTrue(
            lines[0][len(ssh_session.SERVE_PID_PREFIX) :].strip().isdigit()
        )
        self.assertEqual(lines[1:], ["remote-started"])

    def test_ssh_command_keeps_host_and_remote(self) -> None:
        command = ssh_session.ssh_command("nas", "exec /bin/sh")
        self.assertEqual(command[0], "ssh")
        self.assertIn("-T", command)
        self.assertIn("BatchMode=yes", command)
        self.assertEqual(command[-2], "nas")
        self.assertEqual(command[-1], "exec /bin/sh")


if __name__ == "__main__":
    unittest.main()
