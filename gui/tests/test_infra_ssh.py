"""SshTransport + CliGateway 的 fake ssh 联调（255 / 127 / here-doc）。"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.infra import errors
from cdgui.infra.gateway import CliGateway
from cdgui.infra.transport import SshTransport

FAKE_SSH = """#!/bin/sh
for last in "$@"; do :; done
exec /bin/sh -c "$last"
"""

FAKE_CLI = """#!/bin/sh
case "$1" in
  info)
    if [ -n "$CD_CRASH" ]; then kill -9 "$PPID"; fi
    printf 'version=0.1.4-official0.1.4\\nos=linux\\narch=amd64\\n'
    printf 'binary=/volume1/app/chat-deepseek\\ndata_dir=/volume1/data\\n'
    printf 'initialized=true\\nlisten=127.0.0.1:8090\\npublic_url=\\n'
    printf 'api_origin=https://api.deepseek.com\\n'
    printf 'backup_dir=/volume1/data/backups\\nservice_supported=false\\n'
    printf 'service_scope=\\nservice_installed=false\\nservice_active=false\\n'
    printf 'service_enabled=false\\nservice_unit=\\nservice_linger=false\\n'
    ;;
  user)
    if [ "$2" = "list" ]; then
      printf 'USERNAME\\tGROUPS\\tDISABLED\\tID\\n'
      printf 'me\\tOwner,User\\tfalse\\tu1\\n'
      printf 'bob\\tUser\\ttrue\\tu2\\n'
    fi
    ;;
  login)
    cat > "$CD_STDIN_FILE"
    printf '%s' "$PPID" > "$CD_STATE_FILE"
    printf 'ok\\n'
    ;;
  whoami)
    if [ "$(cat "$CD_STATE_FILE" 2>/dev/null)" = "$PPID" ]; then
      printf 'me\\tOwner,User\\t2026-11-26 20:00:00\\n'
    else
      printf '需要登录\\n' >&2
      exit 3
    fi
    ;;
  *)
    printf 'unknown: %s\\n' "$1" >&2
    exit 2
    ;;
esac
"""


def remote_target(binary: str) -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.SSH,
            host="fake",
            binary_dir="/volume1/app",
            data_dir="",
        ),
        binary=binary,
        data_dir="",
    )


@unittest.skipUnless(os.name == "posix", "需要 /bin/sh")
class GatewayOverSshTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binary = self.root / "chat-deepseek"
        self.binary.write_text(FAKE_CLI, encoding="utf-8")
        self.binary.chmod(0o755)
        (self.root / "ssh").write_text(FAKE_SSH, encoding="utf-8")
        (self.root / "ssh").chmod(0o755)
        self.stdin_file = self.root / "stdin.txt"
        self.state_file = self.root / "state.txt"
        self.env = dict(os.environ)
        self.env["PATH"] = str(self.root) + os.pathsep + self.env.get("PATH", "")
        self.env["CD_STDIN_FILE"] = str(self.stdin_file)
        self.env["CD_STATE_FILE"] = str(self.state_file)
        self.env.pop("CD_CRASH", None)
        self.transport = SshTransport(
            remote_target(str(self.binary)), env=self.env
        )
        self.addCleanup(self.transport.close)
        self.gateway = CliGateway(self.transport)

    def test_gateway_info_parses_remote_output(self) -> None:
        info = self.gateway.info()
        self.assertEqual(info.data_dir, "/volume1/data")
        self.assertFalse(info.service_supported)
        self.assertTrue(self.transport.remote_user)

    def test_gateway_users(self) -> None:
        users = self.gateway.users()
        self.assertEqual([user.username for user in users], ["me", "bob"])

    def test_gateway_login_here_doc_and_identity(self) -> None:
        self.gateway.login("me", "p@ss 秘密")
        self.assertEqual(
            self.stdin_file.read_text(encoding="utf-8"), "p@ss 秘密\n"
        )
        identity = self.gateway.whoami()
        self.assertEqual(identity.username, "me")
        self.assertTrue(identity.is_owner)

    def test_missing_remote_binary_is_127(self) -> None:
        transport = SshTransport(
            remote_target("/nonexistent/chat-deepseek"), env=self.env
        )
        self.addCleanup(transport.close)
        with self.assertRaises(errors.CommandError) as caught:
            CliGateway(transport).users()
        self.assertIs(caught.exception.kind, errors.ErrorKind.MISSING_BINARY)
        self.assertIn("fake", caught.exception.failure.message)

    def test_channel_death_is_255_and_reconnects(self) -> None:
        crashing = dict(self.env)
        crashing["CD_CRASH"] = "1"
        transport = SshTransport(
            remote_target(str(self.binary)), env=crashing
        )
        self.addCleanup(transport.close)
        with self.assertRaises(errors.CommandError) as caught:
            CliGateway(transport).info()
        self.assertIs(caught.exception.kind, errors.ErrorKind.TRANSPORT)
        self.assertEqual(caught.exception.code, 255)

    def test_gateway_verify_handshakes(self) -> None:
        self.gateway.verify()
        self.assertTrue(self.transport.connected)


if __name__ == "__main__":
    unittest.main()
