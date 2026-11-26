"""infra.gateway：argv 构造、解析与错误归一化。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.infra import errors
from cdgui.infra.gateway import CliGateway
from cdgui.infra.process import CommandResult

INFO_TEXT = """version=0.1.4-official0.1.4
os=linux
arch=amd64
binary=/srv/bin/chat-deepseek
data_dir=/srv/data
initialized=true
listen=127.0.0.1:8090
public_url=https://chat.example.test
api_origin=https://api.deepseek.com
backup_dir=/srv/backups
service_supported=true
service_scope=user
service_installed=true
service_active=false
service_enabled=true
service_unit=chat-deepseek.service
service_linger=false
"""

USERS_TEXT = (
    "USERNAME\tGROUPS\tDISABLED\tID\n"
    "me\tOwner,User\tfalse\tu1\n"
    "bob\tUser\ttrue\tu2\n"
)

WHOAMI_TEXT = "me\tOwner,User\t2026-11-26 20:00:00\n"

BACKUPS_TEXT = (
    "NAME\tSIZE\tTIME\n"
    "data-20260101-010101.zip\t1.2 MB\t2026-01-01 01:01:01\n"
)


def local_target() -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir="/srv/bin",
            data_dir="/srv/data",
        ),
        binary="/srv/bin/chat-deepseek",
        data_dir="/srv/data",
    )


class DummyHandle:
    marker_pid: int | None = None
    command: tuple[str, ...] = ()
    running = True

    def start(self) -> None:
        self.running = True

    def stop(self, wait: bool = False, timeout: float = 10.0) -> None:
        self.running = False


class FakeTransport:
    def __init__(self, target: Target, *results: CommandResult) -> None:
        self.target = target
        self.results = list(results)
        self.calls = []
        self.cancels = []
        self.serve_calls = []
        self.verify_calls = []
        self.closed = False

    def run(self, spec, cancel=None) -> CommandResult:
        self.calls.append(spec)
        self.cancels.append(cancel)
        if not self.results:
            raise AssertionError("没有预置结果")
        return self.results.pop(0)

    def open_serve(self, spec, *, on_line=None, on_exit=None):
        self.serve_calls.append((spec, on_line, on_exit))
        return DummyHandle()

    def verify(self, timeout: float = 20.0) -> None:
        self.verify_calls.append(timeout)

    def close(self) -> None:
        self.closed = True


def ok(stdout: str = "", stderr: str = "") -> CommandResult:
    return CommandResult(("x",), 0, stdout, stderr)


class GatewayReadTest(unittest.TestCase):
    def test_info(self) -> None:
        transport = FakeTransport(local_target(), ok(INFO_TEXT))
        info = CliGateway(transport).info()
        self.assertEqual(info.version, "0.1.4-official0.1.4")
        self.assertTrue(info.initialized)
        self.assertTrue(info.service_installed)
        self.assertEqual(transport.calls[0].argv, ("info", "--data-dir", "/srv/data"))

    def test_whoami(self) -> None:
        transport = FakeTransport(local_target(), ok(WHOAMI_TEXT))
        identity = CliGateway(transport).whoami()
        self.assertEqual(identity.username, "me")
        self.assertTrue(identity.is_owner)
        self.assertEqual(transport.calls[0].argv, ("whoami", "--data-dir", "/srv/data"))

    def test_users(self) -> None:
        transport = FakeTransport(local_target(), ok(USERS_TEXT))
        users = CliGateway(transport).users()
        self.assertEqual([user.username for user in users], ["me", "bob"])
        self.assertTrue(users[1].disabled)

    def test_users_alias(self) -> None:
        transport = FakeTransport(local_target(), ok(USERS_TEXT))
        self.assertEqual(len(CliGateway(transport).user_list()), 2)

    def test_backups(self) -> None:
        transport = FakeTransport(local_target(), ok(BACKUPS_TEXT))
        backups = CliGateway(transport).backups()
        self.assertEqual(backups[0].name, "data-20260101-010101.zip")
        self.assertEqual(transport.calls[0].argv, ("backup", "list", "--data-dir", "/srv/data"))

    def test_backups_alias(self) -> None:
        transport = FakeTransport(local_target(), ok(BACKUPS_TEXT))
        self.assertEqual(len(CliGateway(transport).backup_list()), 1)

    def test_help_returns_stdout(self) -> None:
        transport = FakeTransport(local_target(), ok("用法：chat-deepseek\n"))
        self.assertEqual(CliGateway(transport).help(), "用法：chat-deepseek\n")
        self.assertEqual(transport.calls[0].argv, ("help",))


class GatewayCommandTest(unittest.TestCase):
    def test_login_uses_stdin_and_quick_timeout(self) -> None:
        transport = FakeTransport(local_target(), ok("ok\n"))
        gateway = CliGateway(transport)
        self.assertIsNone(gateway.login("me", "p@ss"))
        spec = transport.calls[0]
        self.assertEqual(
            spec.argv,
            (
                "login",
                "--username",
                "me",
                "--password-stdin",
                "--data-dir",
                "/srv/data",
            ),
        )
        self.assertEqual(spec.stdin, "p@ss\n")
        self.assertEqual(spec.timeout, 20.0)

    def test_logout(self) -> None:
        transport = FakeTransport(local_target(), ok())
        CliGateway(transport).logout()
        self.assertEqual(
            transport.calls[0].argv, ("logout", "--data-dir", "/srv/data")
        )

    def test_user_add(self) -> None:
        transport = FakeTransport(local_target(), ok())
        CliGateway(transport).user_add("bob", "pw", ("Admin",))
        spec = transport.calls[0]
        self.assertEqual(
            spec.argv,
            (
                "user",
                "add",
                "--data-dir",
                "/srv/data",
                "--group",
                "Admin",
                "--password-stdin",
                "bob",
            ),
        )
        self.assertEqual(spec.stdin, "pw\n")

    def test_user_reset_password(self) -> None:
        transport = FakeTransport(local_target(), ok())
        CliGateway(transport).user_reset_password("bob", "pw")
        self.assertEqual(
            transport.calls[0].argv,
            (
                "user",
                "reset-password",
                "--data-dir",
                "/srv/data",
                "--password-stdin",
                "bob",
            ),
        )

    def test_user_enable_and_disable(self) -> None:
        transport = FakeTransport(local_target(), ok(), ok())
        gateway = CliGateway(transport)
        gateway.user_enable("bob")
        gateway.user_enable("bob", enabled=False)
        self.assertEqual(
            transport.calls[0].argv,
            ("user", "enable", "--data-dir", "/srv/data", "bob"),
        )
        self.assertEqual(
            transport.calls[1].argv,
            ("user", "disable", "--data-dir", "/srv/data", "bob"),
        )

    def test_user_delete_grant_revoke(self) -> None:
        transport = FakeTransport(local_target(), ok(), ok(), ok())
        gateway = CliGateway(transport)
        gateway.user_delete("bob")
        gateway.user_grant("bob", "Admin")
        gateway.user_revoke("bob", "Admin")
        self.assertEqual(
            transport.calls[0].argv,
            ("user", "delete", "--data-dir", "/srv/data", "--yes", "bob"),
        )
        self.assertEqual(
            transport.calls[1].argv,
            ("user", "grant", "--data-dir", "/srv/data", "bob", "Admin"),
        )
        self.assertEqual(
            transport.calls[2].argv,
            ("user", "revoke", "--data-dir", "/srv/data", "bob", "Admin"),
        )

    def test_backup_create_returns_path(self) -> None:
        transport = FakeTransport(
            local_target(), ok("备份已写入 /srv/backups/data-1.zip\n")
        )
        path = CliGateway(transport).backup_create()
        self.assertEqual(path, "/srv/backups/data-1.zip")
        self.assertEqual(transport.calls[0].argv, ("backup", "--data-dir", "/srv/data"))

    def test_backup_as(self) -> None:
        transport = FakeTransport(local_target(), ok("备份已写入 /tmp/x.zip\n"))
        CliGateway(transport).backup_create("/tmp/x.zip")
        self.assertEqual(
            transport.calls[0].argv,
            ("backup", "--output", "/tmp/x.zip", "--data-dir", "/srv/data"),
        )

    def test_backup_restore(self) -> None:
        transport = FakeTransport(local_target(), ok())
        CliGateway(transport).backup_restore("data-1.zip")
        self.assertEqual(
            transport.calls[0].argv,
            ("backup", "restore", "--yes", "--data-dir", "/srv/data", "data-1.zip"),
        )

    def test_service_install_enable_force(self) -> None:
        transport = FakeTransport(local_target(), ok())
        CliGateway(transport).service("install", enable=True, force=True)
        self.assertEqual(
            transport.calls[0].argv,
            (
                "service",
                "install",
                "--enable",
                "--force",
                "--data-dir",
                "/srv/data",
            ),
        )

    def test_service_update_is_explicit(self) -> None:
        transport = FakeTransport(local_target(), ok())
        CliGateway(transport).service("update", enable=False)
        self.assertEqual(
            transport.calls[0].argv,
            (
                "service",
                "install",
                "--disable",
                "--force",
                "--data-dir",
                "/srv/data",
            ),
        )

    def test_service_start(self) -> None:
        transport = FakeTransport(local_target(), ok())
        CliGateway(transport).service("start")
        self.assertEqual(transport.calls[0].argv, ("service", "start"))

    def test_config_set(self) -> None:
        transport = FakeTransport(local_target(), ok())
        CliGateway(transport).config_set("listen", "127.0.0.1:8091")
        self.assertEqual(
            transport.calls[0].argv,
            (
                "config",
                "set",
                "listen",
                "127.0.0.1:8091",
                "--data-dir",
                "/srv/data",
            ),
        )

    def test_cancel_token_is_forwarded(self) -> None:
        transport = FakeTransport(local_target(), ok(WHOAMI_TEXT))
        token = object()
        CliGateway(transport).whoami(token)
        self.assertIs(transport.cancels[0], token)


class GatewayErrorTest(unittest.TestCase):
    def test_auth_error_raises_command_error(self) -> None:
        transport = FakeTransport(
            local_target(), CommandResult(("whoami",), 3, "", "需要登录")
        )
        with self.assertRaises(errors.CommandError) as caught:
            CliGateway(transport).whoami()
        self.assertIs(caught.exception.kind, errors.ErrorKind.AUTH)

    def test_transport_error_is_255(self) -> None:
        transport = FakeTransport(
            local_target(), CommandResult(("info",), 255, "", "SSH 连接已断开")
        )
        with self.assertRaises(errors.CommandError) as caught:
            CliGateway(transport).info()
        self.assertIs(caught.exception.kind, errors.ErrorKind.TRANSPORT)

    def test_bad_success_output_is_parse_error(self) -> None:
        transport = FakeTransport(local_target(), ok("garbage"))
        with self.assertRaises(errors.CommandError) as caught:
            CliGateway(transport).info()
        self.assertIs(caught.exception.kind, errors.ErrorKind.PARSE)


class GatewayServeTest(unittest.TestCase):
    def test_serve_returns_handle_and_forwards_callbacks(self) -> None:
        transport = FakeTransport(local_target())
        gateway = CliGateway(transport)
        lines: list[str] = []

        handle = gateway.serve(on_line=lines.append, on_exit=lambda code: None)
        self.assertIsInstance(handle, DummyHandle)
        spec, on_line, on_exit = transport.serve_calls[0]
        self.assertEqual(spec.argv, ("serve", "--no-browser", "--data-dir", "/srv/data"))
        self.assertEqual(on_line, lines.append)
        self.assertTrue(callable(on_exit))

    def test_verify_and_close_forwarded(self) -> None:
        transport = FakeTransport(local_target())
        gateway = CliGateway(transport)
        gateway.verify(7.5)
        gateway.close()
        self.assertEqual(transport.verify_calls, [7.5])
        self.assertTrue(transport.closed)


if __name__ == "__main__":
    unittest.main()
