from __future__ import annotations

import sys
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.domain import commands
from cdgui.domain.target import ConnectionKind, Endpoint, Target


def local() -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL, binary_dir="/opt", data_dir="/srv/data"
        ),
        binary="/opt/chat-deepseek",
        data_dir="/srv/data",
    )


def remote(data_dir: str = "") -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.SSH,
            host="nas",
            binary_dir="/opt",
            data_dir=data_dir,
        ),
        binary="/opt/chat-deepseek",
        data_dir=data_dir,
    )


class ArgvGoldenTest(unittest.TestCase):
    def test_account_commands(self) -> None:
        target = local()
        cases = {
            "login": (
                commands.login(target, "me", "secret").argv,
                (
                    "login",
                    "--username",
                    "me",
                    "--password-stdin",
                    "--data-dir",
                    "/srv/data",
                ),
            ),
            "whoami": (
                commands.whoami(target).argv,
                ("whoami", "--data-dir", "/srv/data"),
            ),
            "logout": (
                commands.logout(target).argv,
                ("logout", "--data-dir", "/srv/data"),
            ),
            "user_list": (
                commands.user_list(target).argv,
                ("user", "list", "--data-dir", "/srv/data"),
            ),
            "user_add": (
                commands.user_add(
                    target, "bob", "pw", ("Admin", "Owner")
                ).argv,
                (
                    "user",
                    "add",
                    "--data-dir",
                    "/srv/data",
                    "--group",
                    "Admin",
                    "--group",
                    "Owner",
                    "--password-stdin",
                    "bob",
                ),
            ),
            "reset": (
                commands.user_reset_password(target, "bob", "pw").argv,
                (
                    "user",
                    "reset-password",
                    "--data-dir",
                    "/srv/data",
                    "--password-stdin",
                    "bob",
                ),
            ),
            "enable": (
                commands.user_enable(target, "bob").argv,
                ("user", "enable", "--data-dir", "/srv/data", "bob"),
            ),
            "disable": (
                commands.user_disable(target, "bob").argv,
                ("user", "disable", "--data-dir", "/srv/data", "bob"),
            ),
            "grant": (
                commands.user_grant(target, "bob", "Owner").argv,
                ("user", "grant", "--data-dir", "/srv/data", "bob", "Owner"),
            ),
            "revoke": (
                commands.user_revoke(target, "bob", "Owner").argv,
                ("user", "revoke", "--data-dir", "/srv/data", "bob", "Owner"),
            ),
            "delete": (
                commands.user_delete(target, "bob").argv,
                ("user", "delete", "--data-dir", "/srv/data", "--yes", "bob"),
            ),
            "setup": (
                commands.setup(
                    target, "owner", "pw", listen="127.0.0.1:8090"
                ).argv,
                (
                    "setup",
                    "--username",
                    "owner",
                    "--password-stdin",
                    "--data-dir",
                    "/srv/data",
                    "--listen",
                    "127.0.0.1:8090",
                ),
            ),
        }
        for name, (actual, expected) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(actual, expected)

    def test_backup_commands(self) -> None:
        target = local()
        self.assertEqual(
            commands.backup_now(target).argv,
            ("backup", "--data-dir", "/srv/data"),
        )
        self.assertEqual(
            commands.backup_as(target, "/tmp/a.zip").argv,
            ("backup", "--output", "/tmp/a.zip", "--data-dir", "/srv/data"),
        )
        self.assertEqual(
            commands.backup_list(target).argv,
            ("backup", "list", "--data-dir", "/srv/data"),
        )
        self.assertEqual(
            commands.backup_restore(target, "a.zip").argv,
            (
                "backup",
                "restore",
                "--yes",
                "--data-dir",
                "/srv/data",
                "a.zip",
            ),
        )

    def test_service_commands(self) -> None:
        target = local()
        self.assertEqual(
            commands.service_install(target).argv,
            ("service", "install", "--data-dir", "/srv/data"),
        )
        self.assertEqual(
            commands.service_install(target, enable=True, force=True).argv,
            (
                "service",
                "install",
                "--enable",
                "--force",
                "--data-dir",
                "/srv/data",
            ),
        )
        self.assertEqual(
            commands.service_update(target, enable=True).argv,
            (
                "service",
                "install",
                "--enable",
                "--force",
                "--data-dir",
                "/srv/data",
            ),
        )
        self.assertEqual(
            commands.service_update(target, enable=False).argv,
            (
                "service",
                "install",
                "--disable",
                "--force",
                "--data-dir",
                "/srv/data",
            ),
        )
        for name, spec in (
            ("start", commands.service_start(target)),
            ("stop", commands.service_stop(target)),
            ("restart", commands.service_restart(target)),
            ("uninstall", commands.service_uninstall(target)),
        ):
            with self.subTest(name=name):
                self.assertEqual(spec.argv, ("service", name))

    def test_service_cmd_dispatch(self) -> None:
        target = local()
        self.assertEqual(
            commands.service_cmd(target, "start").argv, ("service", "start")
        )
        self.assertEqual(
            commands.service_cmd(target, "update", enable=False).argv,
            (
                "service",
                "install",
                "--disable",
                "--force",
                "--data-dir",
                "/srv/data",
            ),
        )
        with self.assertRaises(ValueError):
            commands.service_cmd(target, "explode")

    def test_info_config_serve_help_kill(self) -> None:
        target = local()
        self.assertEqual(
            commands.info(target).argv, ("info", "--data-dir", "/srv/data")
        )
        self.assertEqual(
            commands.test_connection(target).argv,
            commands.info(target).argv,
        )
        self.assertEqual(
            commands.config_set(target, "listen", "127.0.0.1:9000").argv,
            (
                "config",
                "set",
                "listen",
                "127.0.0.1:9000",
                "--data-dir",
                "/srv/data",
            ),
        )
        self.assertEqual(
            commands.serve(target).argv,
            ("serve", "--no-browser", "--data-dir", "/srv/data"),
        )
        self.assertEqual(commands.help_command(target).argv, ("help",))
        self.assertEqual(
            commands.kill_serve(4321).argv, ("kill", "-TERM", "4321")
        )

    def test_remote_omits_empty_data_dir(self) -> None:
        target = remote()
        self.assertEqual(
            commands.login(target, "me", "pw").argv,
            ("login", "--username", "me", "--password-stdin"),
        )
        self.assertEqual(commands.whoami(target).argv, ("whoami",))
        self.assertEqual(commands.backup_now(target).argv, ("backup",))
        self.assertEqual(
            commands.serve(target).argv, ("serve", "--no-browser")
        )
        with self.assertRaises(ValueError):
            commands.service_install(target)


class TimeoutAndStdinTest(unittest.TestCase):
    def test_timeouts(self) -> None:
        target = local()
        for spec in (
            commands.backup_now(target),
            commands.backup_as(target, "/tmp/a.zip"),
            commands.backup_list(target),
            commands.backup_restore(target, "a.zip"),
        ):
            self.assertEqual(spec.timeout, 1800.0)
        for spec in (
            commands.info(target),
            commands.test_connection(target),
            commands.login(target, "me", "pw"),
            commands.whoami(target),
        ):
            self.assertEqual(spec.timeout, 20.0)
        for spec in (
            commands.logout(target),
            commands.user_list(target),
            commands.user_add(target, "bob", "pw"),
            commands.user_reset_password(target, "bob", "pw"),
            commands.user_enable(target, "bob"),
            commands.user_grant(target, "bob", "Owner"),
            commands.user_delete(target, "bob"),
            commands.setup(target, "owner", "pw"),
            commands.config_set(target, "listen", "x"),
            commands.serve(target),
            commands.service_install(target),
            commands.service_update(target, enable=True),
            commands.service_start(target),
            commands.service_stop(target),
            commands.service_restart(target),
            commands.service_uninstall(target),
            commands.help_command(target),
        ):
            self.assertEqual(spec.timeout, 120.0)

    def test_kill_timeout_is_five_seconds(self) -> None:
        spec = commands.kill_serve(4321)
        self.assertEqual(spec.timeout, commands.TIMEOUT_KILL)
        self.assertEqual(spec.timeout, 5.0)

    def test_passwords_only_in_stdin(self) -> None:
        password = "s3cr3t-with space"
        specs = (
            commands.login(local(), "me", password),
            commands.setup(local(), "owner", password),
            commands.user_add(local(), "bob", password),
            commands.user_reset_password(local(), "bob", password),
        )
        for spec in specs:
            with self.subTest(argv=spec.argv):
                self.assertEqual(spec.stdin, password + "\n")
                self.assertNotIn(password, spec.argv)
                self.assertIn("--password-stdin", spec.argv)

    def test_other_stdin_is_none(self) -> None:
        self.assertIsNone(commands.backup_now(local()).stdin)
        self.assertIsNone(commands.logout(local()).stdin)
        self.assertIsNone(commands.kill_serve(1).stdin)

    def test_user_toggle(self) -> None:
        target = local()
        self.assertEqual(
            commands.user_toggle(target, "bob", disabled=True).argv,
            ("user", "enable", "--data-dir", "/srv/data", "bob"),
        )
        self.assertEqual(
            commands.user_toggle(target, "bob", disabled=False).argv,
            ("user", "disable", "--data-dir", "/srv/data", "bob"),
        )

    def test_command_spec_is_immutable(self) -> None:
        spec = commands.info(local())
        with self.assertRaises(FrozenInstanceError):
            spec.argv = ()  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
