"""Controller 编排层：FakeTransport 驱动任务顺序、失败分支与切目标。"""

from __future__ import annotations

import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import gui_config
import parsing

from cdgui.controller import BUSY_TEXT, Controller
from cdgui.domain.state import (
    LoginPrompt,
    NoticeTone,
    PageId,
    Phase,
    TaskKey,
)
from cdgui.domain.target import (
    ConnectionKind,
    Endpoint,
    Target,
    resolve_target,
)
from cdgui.infra.errors import CommandError, ErrorKind
from cdgui.infra.process import (
    CANCELLED_STDERR,
    TIMEOUT_STDERR,
    CommandResult,
)
from cdgui.infra.runner import QueuePump
from cdgui.infra.transport import SshTransport

FIXED_NOW = datetime(2026, 11, 26, 19, 0, 0)


def wait_until(predicate, timeout: float = 3.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    raise AssertionError("等待条件超时")


def result(argv: tuple[str, ...], code: int = 0, stdout: str = "", stderr: str = "") -> CommandResult:
    return CommandResult(tuple(argv), code, stdout, stderr)


def ok(argv: tuple[str, ...], stdout: str = "") -> CommandResult:
    return result(argv, 0, stdout, "")


def failure(
    argv: tuple[str, ...], code: int, stderr: str = "", stdout: str = ""
) -> CommandResult:
    return result(argv, code, stdout, stderr)


INFO_KEYS = parsing.INFO_KEYS


def info_result(**overrides: object) -> CommandResult:
    values: dict[str, str] = {
        "version": "0.1.4",
        "os": "linux",
        "arch": "amd64",
        "binary": "/opt/chat-deepseek",
        "data_dir": "/data",
        "initialized": "true",
        "listen": "127.0.0.1:8090",
        "public_url": "",
        "api_origin": "https://api.deepseek.com",
        "backup_dir": "/data/backups",
        "service_supported": "true",
        "service_scope": "",
        "service_installed": "false",
        "service_active": "false",
        "service_enabled": "false",
        "service_unit": "",
        "service_linger": "false",
    }
    for key, value in overrides.items():
        if isinstance(value, bool):
            values[key] = "true" if value else "false"
        else:
            values[key] = str(value)
    text = "\n".join(f"{key}={values[key]}" for key in INFO_KEYS) + "\n"
    return ok(("info",), text)


def whoami_result(
    username: str = "alice",
    groups: tuple[str, ...] = ("Owner",),
    expires: str = "2026-12-01 10:00:00",
) -> CommandResult:
    return ok(("whoami",), f"{username}\t{','.join(groups)}\t{expires}\n")


def users_result(*rows: tuple[str, str, bool, str]) -> CommandResult:
    lines = ["USERNAME\tGROUPS\tDISABLED\tID"]
    for username, groups, disabled, user_id in rows:
        lines.append(f"{username}\t{groups}\t{str(disabled).lower()}\t{user_id}")
    return ok(("user", "list"), "\n".join(lines) + "\n")


def backup_list_result(*rows: tuple[str, str, str]) -> CommandResult:
    lines = ["NAME\tSIZE\tTIME"]
    for name, size, stamp in rows:
        lines.append(f"{name}\t{size}\t{stamp}")
    return ok(("backup", "list"), "\n".join(lines) + "\n")


BACKUP_ONE = ("chat-deepseek-20261126-180000.zip", "1.0 MB", "2026-11-26 18:00:00")


class FakeServeHandle:
    """与 infra.ServeHandle 同形；测试里手动 emit/finish 驱动日志与退出。"""

    def __init__(self, spec, on_line, on_exit) -> None:
        self.command = tuple(spec.argv)
        self.marker_pid = 4321
        self.running = False
        self.on_line = on_line
        self.on_exit = on_exit
        self.stops: list[tuple[bool, float]] = []
        self.exit_on_stop = True
        self._exited = False

    def start(self) -> None:
        self.running = True

    def emit(self, line: str) -> None:
        self.on_line(line)

    def finish(self, code: int = 0) -> None:
        if self._exited:
            return
        self._exited = True
        self.running = False
        self.on_exit(code)

    def stop(self, wait: bool = False, timeout: float = 10.0) -> None:
        self.stops.append((wait, timeout))
        self.running = False
        if self.exit_on_stop:
            self.finish(0)


class FakeTransport:
    """按 argv 前缀脚本化结果的传输层；支持延迟/取消/坏输出。"""

    def __init__(self, target: Target) -> None:
        self.target = target
        self.calls: list[tuple[tuple[str, ...], str | None]] = []
        self.closed = 0
        self.verified: list[float] = []
        self.verify_error: BaseException | None = None
        self.handles: list[FakeServeHandle] = []
        self._scripts: dict[tuple[str, ...], list[object]] = {}
        self._lock = threading.Lock()
        self._hold: threading.Event | None = None

    # ---- 脚本 ---------------------------------------------------------

    def script(self, prefix: tuple[str, ...], *items: CommandResult) -> None:
        with self._lock:
            self._scripts.setdefault(tuple(prefix), []).extend(items)

    def hold(self) -> threading.Event:
        event = threading.Event()
        self._hold = event
        return event

    def release(self) -> None:
        self._hold = None

    @property
    def argv_calls(self) -> list[tuple[str, ...]]:
        return [argv for argv, _stdin in self.calls]

    def calls_for(self, verb: str) -> list[tuple[str, ...]]:
        return [argv for argv in self.argv_calls if argv and argv[0] == verb]

    # ---- Transport 协议 ----------------------------------------------

    def run(self, spec, cancel=None) -> CommandResult:
        with self._lock:
            self.calls.append((tuple(spec.argv), spec.stdin))
            hold = self._hold
        if hold is not None:
            while not hold.wait(0.005):
                if cancel is not None and cancel.cancelled:
                    return failure(tuple(spec.argv), 1, CANCELLED_STDERR)
        with self._lock:
            item = self._match(tuple(spec.argv))
        if item is None:
            return ok(tuple(spec.argv))
        if callable(item):
            return item(spec, cancel)
        return item

    def _match(self, argv: tuple[str, ...]) -> object | None:
        for prefix in sorted(self._scripts, key=len, reverse=True):
            if argv[: len(prefix)] == prefix:
                queue = self._scripts[prefix]
                if queue:
                    return queue.pop(0)
        return None

    def open_serve(self, spec, *, on_line=None, on_exit=None) -> FakeServeHandle:
        handle = FakeServeHandle(
            spec,
            on_line or (lambda _line: None),
            on_exit or (lambda _code: None),
        )
        handle.start()
        with self._lock:
            self.handles.append(handle)
        return handle

    def verify(self, timeout: float = 20.0) -> None:
        with self._lock:
            self.verified.append(timeout)
        if self.verify_error is not None:
            raise self.verify_error

    def close(self) -> None:
        with self._lock:
            self.closed += 1


def local_target(data_dir: str = "/data") -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir="/opt",
            data_dir=data_dir,
        ),
        binary="/opt/chat-deepseek",
        data_dir=data_dir,
    )


def remote_target() -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.SSH,
            host="nas",
            binary_dir="/opt",
            data_dir="",
        ),
        binary="/opt/chat-deepseek",
        data_dir="",
    )


class ControllerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.config_path = self.tmp / "config.gui.json"
        self.pump = QueuePump()
        self.target = local_target()
        self._controllers: list[Controller] = []

    def tearDown(self) -> None:
        for controller in self._controllers:
            controller.shutdown()
        self.pump.close()

    # ---- 构造与驱动 ---------------------------------------------------

    def make_controller(
        self,
        *,
        transport: FakeTransport | None = None,
        target: Target | None = None,
        config: gui_config.Config | None = None,
        factory=None,
        config_path: Path | None = None,
        pump: QueuePump | None = None,
    ) -> Controller:
        target = target or self.target
        transport = transport or FakeTransport(target)
        config = config or gui_config.Config(
            connection="local",
            local=gui_config.LocalConfig(
                binary_dir="/opt", data_dir="/data", username="old"
            ),
        )
        controller = Controller(
            target=target,
            transport=transport,
            config=config,
            config_path=config_path or self.config_path,
            transport_factory=factory or FakeTransport,
            clock=lambda: FIXED_NOW,
            pump=pump or self.pump,
        )
        self._controllers.append(controller)
        return controller

    def drain(self, pump: QueuePump | None = None, timeout: float = 2.0) -> None:
        """排空回投队列；worker 线程可能还没把结果 post 进来，所以要等。"""
        current = pump or self.pump
        controller = self._controllers[-1] if self._controllers else None
        deadline = time.monotonic() + timeout
        while True:
            current.drain()
            if current.closed:
                return
            if (
                controller is not None
                and (
                    controller.state.closing
                    or controller.state.phase is Phase.CLOSING
                )
            ):
                return
            inflight = bool(
                controller is not None and controller.state.inflight
            )
            if current.pending == 0 and not inflight:
                return
            if time.monotonic() >= deadline:
                return
            time.sleep(0.002)

    def script_login(self, transport: FakeTransport, *extra_whoami: CommandResult) -> None:
        transport.script(("login",), ok(("login",), "已登录\n"))
        transport.script(("whoami",), whoami_result(), *extra_whoami)
        transport.script(("user", "list"), users_result())
        transport.script(("backup", "list"), backup_list_result())

    def logged_in(
        self,
        transport: FakeTransport | None = None,
        *,
        groups: tuple[str, ...] = ("Owner",),
    ) -> tuple[Controller, FakeTransport]:
        transport = transport or FakeTransport(self.target)
        transport.script(("login",), ok(("login",), "已登录\n"))
        transport.script(("whoami",), whoami_result(groups=groups))
        transport.script(("user", "list"), users_result())
        transport.script(("backup", "list"), backup_list_result())
        controller = self.make_controller(transport=transport)
        controller.login("alice", "pw")
        self.drain()
        self.assertIsNotNone(controller.state.identity)
        return controller, transport

    # ---- 断言辅助 -----------------------------------------------------

    def assert_notice(self, controller: Controller, text: str) -> None:
        notice = controller.state.notice
        self.assertIsNotNone(notice)
        assert notice is not None
        self.assertEqual(notice.text, text)

    def assert_dialog(self, controller: Controller, title: str) -> None:
        notice = controller.state.notice
        self.assertIsNotNone(notice)
        assert notice is not None
        self.assertTrue(notice.dialog)
        self.assertEqual(notice.title, title)

    def verbs(self, transport: FakeTransport) -> list[tuple[str, ...]]:
        """归一化 argv：子命令取前两段，带 --data-dir 的普通命令只留动词。"""
        normalized: list[tuple[str, ...]] = []
        for argv in transport.argv_calls:
            if len(argv) > 1 and not argv[1].startswith("--"):
                normalized.append(argv[:2])
            else:
                normalized.append((argv[0],))
        return normalized


class BootstrapTest(ControllerTestCase):
    def test_bootstrap_success_loads_info_and_ready(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("info",), info_result())
        controller = self.make_controller(transport=transport)

        controller.bootstrap()
        self.assertEqual(controller.state.phase, Phase.BOOTING)
        self.assertIn(TaskKey.INFO, controller.state.inflight)
        self.drain()

        self.assertEqual(controller.state.phase, Phase.READY)
        host = controller.state.hosts[controller.state.target.key]
        self.assertTrue(host.initialized)
        self.assertEqual(host.listen, "127.0.0.1:8090")
        self.assertIsNone(controller.state.info_error)

    def test_bootstrap_failure_marks_info_error_and_ready(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("info",), failure(("info",), 127, "boom"))
        controller = self.make_controller(transport=transport)

        controller.bootstrap()
        self.drain()

        self.assertEqual(controller.state.phase, Phase.READY)
        self.assertEqual(controller.state.hosts, {})
        self.assertIsNotNone(controller.state.info_error)
        self.assert_dialog(controller, "找不到 chat-deepseek")

    def test_bootstrap_parse_failure_is_dialog(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("info",), ok(("info",), "坏输出\n"))
        controller = self.make_controller(transport=transport)

        controller.bootstrap()
        self.drain()

        self.assertEqual(controller.state.phase, Phase.READY)
        self.assert_dialog(controller, "未知错误")


class LoginTest(ControllerTestCase):
    def test_login_order_is_login_whoami_users_backups(self) -> None:
        controller, transport = self.logged_in()

        verbs = [argv[0] for argv in transport.argv_calls]
        self.assertEqual(
            verbs, ["login", "whoami", "user", "backup"]
        )
        self.assertEqual(controller.state.identity.username, "alice")
        self.assertIsNone(controller.state.login)
        self.assertEqual(controller.state.users, ())
        self.assertEqual(controller.state.backups, ())

    def test_login_only_sends_password_on_stdin(self) -> None:
        controller, transport = self.logged_in()
        login_call = transport.calls[0]
        self.assertEqual(login_call[1], "pw\n")
        self.assertNotIn("pw", login_call[0])

    def test_login_writes_username_back_to_config(self) -> None:
        self.logged_in()
        saved = gui_config.load(self.config_path)
        self.assertEqual(saved.local.username, "alice")

    def test_login_auth_failure_keeps_prompt_with_error(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(
            ("login",),
            failure(("login",), 3, "登录已失效，请重新登录"),
        )
        controller = self.make_controller(transport=transport)

        controller.login("alice", "bad")
        self.drain()

        prompt = controller.state.login
        self.assertIsNotNone(prompt)
        assert isinstance(prompt, LoginPrompt)
        self.assertEqual(prompt.username, "alice")
        self.assertIn("重新登录", prompt.error)
        self.assertIsNone(controller.state.identity)
        self.assertEqual(transport.calls_for("whoami"), [])

    def test_login_wrong_password_keeps_prompt_with_message(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("login",), failure(("login",), 1, "密码错误"))
        controller = self.make_controller(transport=transport)

        controller.login("alice", "bad")
        self.drain()

        prompt = controller.state.login
        self.assertIsNotNone(prompt)
        assert prompt is not None
        self.assertEqual(prompt.error, "密码不正确，请重新输入。")

    def test_login_non_admin_clears_identity_and_notices(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("login",), ok(("login",)))
        transport.script(("whoami",), whoami_result(groups=("User",)))
        controller = self.make_controller(transport=transport)

        controller.login("alice", "pw")
        self.drain()

        self.assertIsNone(controller.state.identity)
        self.assert_notice(controller, "没有管理权限")
        self.assertEqual(transport.calls_for("user"), [])

    def test_login_transport_failure_closes_and_expires(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("login",), failure(("login",), 255, "ssh: disconnect"))
        controller = self.make_controller(transport=transport)

        controller.login("alice", "pw")
        self.drain()

        self.assertEqual(transport.closed, 1)
        self.assertIsNone(controller.state.identity)
        self.assert_dialog(controller, "SSH 连接失败")
        notice = controller.state.notice
        assert notice is not None
        self.assertEqual(notice.text, "SSH 连接已断开，请重新登录")

    def test_login_missing_binary_dialog(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("login",), failure(("login",), 127, "boom"))
        controller = self.make_controller(transport=transport)

        controller.login("alice", "pw")
        self.drain()

        self.assert_dialog(controller, "找不到 chat-deepseek")

    def test_login_parse_failure_of_whoami_dialog(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("login",), ok(("login",)))
        transport.script(("whoami",), ok(("whoami",), "garbage\n"))
        controller = self.make_controller(transport=transport)

        controller.login("alice", "pw")
        self.drain()

        self.assert_dialog(controller, "未知错误")
        self.assertIn("无法处理", controller.state.notice.text)

    def test_login_forbidden_clears_and_notices(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(
            ("login",), failure(("login",), 4, "该账户没有 CLI 管理权限")
        )
        controller = self.make_controller(transport=transport)

        controller.login("alice", "pw")
        self.drain()

        self.assertIsNone(controller.state.identity)
        self.assertIsNone(controller.state.login)
        self.assert_notice(controller, "没有管理权限")
        self.assertEqual(transport.calls_for("whoami"), [])

    def test_login_whoami_forbidden_dialog(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("login",), ok(("login",)))
        transport.script(
            ("whoami",), failure(("whoami",), 4, "该账户没有 CLI 管理权限")
        )
        controller = self.make_controller(transport=transport)

        controller.login("alice", "pw")
        self.drain()

        self.assert_dialog(controller, "没有管理权限")
        self.assertIsNone(controller.state.identity)


class EnsureLoginTest(ControllerTestCase):
    def test_ensure_login_returns_true_when_logged_in(self) -> None:
        controller, _transport = self.logged_in()
        called: list[str] = []
        self.assertTrue(controller.ensure_login(lambda: called.append("then")))
        self.assertEqual(called, ["then"])

    def test_ensure_login_prompts_with_last_username(self) -> None:
        controller = self.make_controller()
        called: list[str] = []
        self.assertFalse(controller.ensure_login(lambda: called.append("then")))
        prompt = controller.state.login
        self.assertIsNotNone(prompt)
        assert prompt is not None
        self.assertEqual(prompt.username, "old")
        self.assertEqual(called, [])

    def test_pending_action_runs_after_login_lists(self) -> None:
        transport = FakeTransport(self.target)
        self.script_login(transport)
        transport.script(("backup",), ok(("backup",), "备份已写入 /data/backups/x.zip\n"))
        # pending 会触发 backup_now，成功后还会刷新 backup list。
        transport.script(("backup", "list"), backup_list_result(BACKUP_ONE))
        controller = self.make_controller(transport=transport)

        self.assertFalse(controller.ensure_login(controller.backup_now))
        controller.login("alice", "pw")
        self.drain()

        self.assertEqual(
            self.verbs(transport),
            [
                ("login",),
                ("whoami",),
                ("user", "list"),
                ("backup", "list"),
                ("backup",),
                ("backup", "list"),
            ],
        )
        self.assertEqual(len(controller.state.backups), 1)


class SetupOwnerTest(ControllerTestCase):
    def bootstrapped(self, *, initialized: bool) -> tuple[Controller, FakeTransport]:
        transport = FakeTransport(self.target)
        transport.script(("info",), info_result(initialized=initialized))
        controller = self.make_controller(transport=transport)
        controller.bootstrap()
        self.drain()
        return controller, transport

    def test_setup_owner_success_argv_stdin_info_and_prompt(self) -> None:
        controller, transport = self.bootstrapped(initialized=False)
        transport.script(("setup",), ok(("setup",), "Owner 已创建\n"))
        transport.script(("info",), info_result(initialized=True))
        controller.setup_owner("owner", "pw")
        self.drain()

        setups = [item for item in transport.calls if item[0][:1] == ("setup",)]
        self.assertEqual(len(setups), 1)
        self.assertEqual(
            setups[0][0],
            (
                "setup",
                "--username",
                "owner",
                "--password-stdin",
                "--data-dir",
                "/data",
                "--listen",
                "127.0.0.1:8090",
            ),
        )
        self.assertEqual(setups[0][1], "pw\n")
        self.assertEqual(
            len([argv for argv in transport.argv_calls if argv[0] == "info"]), 2
        )
        prompt = controller.state.login
        self.assertIsNotNone(prompt)
        assert prompt is not None
        self.assertEqual(prompt.username, "owner")
        self.assertEqual(prompt.error, "")
        self.assert_notice(controller, "Owner 已创建，请登录")

    def test_setup_owner_failure_uses_unified_failure(self) -> None:
        controller, transport = self.bootstrapped(initialized=False)
        transport.script(("setup",), failure(("setup",), 1, "已经初始化过"))
        controller.setup_owner("owner", "pw")
        self.drain()

        self.assert_dialog(controller, "数据目录已初始化")
        self.assertIsNone(controller.state.login)

    def test_setup_owner_guard_when_already_initialized(self) -> None:
        controller, transport = self.bootstrapped(initialized=True)
        calls_before = len(transport.calls)
        controller.setup_owner("owner", "pw")
        self.drain()

        self.assertEqual(len(transport.calls), calls_before)
        self.assertEqual(
            transport.calls_for("setup"), []
        )
        self.assert_notice(controller, "数据目录已经初始化")


class BusyTest(ControllerTestCase):
    def test_user_action_rejected_while_busy(self) -> None:
        controller, transport = self.logged_in()
        hold = transport.hold()

        controller.refresh_backups()
        wait_until(lambda: TaskKey.BACKUPS in controller.state.inflight)
        controller.refresh_users()

        self.assert_notice(controller, BUSY_TEXT)
        hold.set()
        transport.release()
        self.drain()

    def test_internal_followups_use_blocking_false(self) -> None:
        # login 成功后的 whoami/users/backups 都是 blocking=False，按顺序排在同一条 lane。
        controller, transport = self.logged_in()
        verbs = [argv[0] for argv in transport.argv_calls]
        self.assertEqual(verbs, ["login", "whoami", "user", "backup"])


class FailureTest(ControllerTestCase):
    def test_users_auth_failure_expires_login(self) -> None:
        transport = FakeTransport(self.target)
        transport.script(("login",), ok(("login",)))
        transport.script(("whoami",), whoami_result())
        transport.script(("user", "list"), failure(("user", "list"), 3, "登录已失效"))
        transport.script(("backup", "list"), backup_list_result())
        controller = self.make_controller(transport=transport)

        controller.login("alice", "pw")
        self.drain()

        self.assertIsNone(controller.state.identity)
        self.assert_notice(controller, "登录已失效，请重新登录")
        # 失败后清态；列表结果即使已执行也不能落地。
        self.assertEqual(controller.state.users, ())
        self.assertEqual(controller.state.backups, ())

    def test_forbidden_user_action_dialog_keeps_identity(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("user", "add"), failure(("user", "add"), 4, "只有 Owner 可以指定组"))
        controller.add_user("bob", "secret", ("Admin",))
        self.drain()

        self.assertIsNotNone(controller.state.identity)
        self.assert_dialog(controller, "只有 Owner 可以指定组")

    def test_transport_failure_on_command_expires(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("backup",), failure(("backup",), 255, "ssh gone"))
        controller.backup_now()
        self.drain()

        self.assertIsNone(controller.state.identity)
        self.assertEqual(transport.closed, 1)
        self.assertEqual(
            controller.state.notice.text, "SSH 连接已断开，请重新登录"
        )

    def test_timeout_is_warning_notice(self) -> None:
        controller, transport = self.logged_in()
        transport.script(
            ("backup",), failure(("backup",), 1, TIMEOUT_STDERR)
        )
        controller.backup_now()
        self.drain()

        notice = controller.state.notice
        self.assertIsNotNone(notice)
        assert notice is not None
        self.assertIs(notice.tone, NoticeTone.WARNING)
        self.assertFalse(notice.dialog)
        self.assertIn("命令执行时间过长", notice.text)

    def test_cancelled_is_silent(self) -> None:
        controller, transport = self.logged_in()
        controller.dismiss_notice()
        transport.script(("backup",), failure(("backup",), 1, CANCELLED_STDERR))
        controller.backup_now()
        self.drain()

        self.assertIsNone(controller.state.notice)


class UserActionTest(ControllerTestCase):
    def test_add_user_argv_and_stdin(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("user", "add"), ok(("user", "add")))
        transport.script(("whoami",), whoami_result())
        controller.add_user("bob", "secret", ("User",))
        self.drain()

        call = [item for item in transport.calls if item[0][:2] == ("user", "add")][0]
        self.assertEqual(
            call[0],
            (
                "user",
                "add",
                "--data-dir",
                "/data",
                "--group",
                "User",
                "--password-stdin",
                "bob",
            ),
        )
        self.assertEqual(call[1], "secret\n")
        self.assert_notice(controller, "账户已创建")

    def test_reset_password_other_refreshes_lists(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("user", "reset-password"), ok(("user", "reset-password")))
        transport.script(("whoami",), whoami_result())
        transport.script(("user", "list"), users_result())
        transport.script(("backup", "list"), backup_list_result())
        controller.reset_password("bob", "secret")
        self.drain()

        self.assert_notice(controller, "密码已重置，旧会话已吊销")
        self.assertTrue(
            any(argv[:2] == ("backup", "list") for argv in transport.argv_calls)
        )

    def test_reset_own_password_logs_out(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("user", "reset-password"), ok(("user", "reset-password")))
        controller.reset_password("alice", "secret")
        self.drain()

        self.assertIsNone(controller.state.identity)
        self.assert_notice(controller, "密码已重置，请重新登录")

    def test_set_user_enabled_argv(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("user", "disable"), ok(("user", "disable")))
        transport.script(("whoami",), whoami_result())
        controller.set_user_enabled("bob", False)
        self.drain()

        call = [item for item in transport.calls if item[0][:2] == ("user", "disable")][0]
        self.assertEqual(
            call[0], ("user", "disable", "--data-dir", "/data", "bob")
        )
        self.assert_notice(controller, "已禁用")

    def test_change_group_grant_and_revoke(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("user", "grant"), ok(("user", "grant")))
        transport.script(("user", "revoke"), ok(("user", "revoke")))
        transport.script(("whoami",), whoami_result(), whoami_result())
        controller.change_group("bob", "Admin", True)
        self.drain()
        controller.change_group("bob", "Admin", False)
        self.drain()

        grants = [argv for argv in transport.argv_calls if argv[:2] == ("user", "grant")]
        revokes = [argv for argv in transport.argv_calls if argv[:2] == ("user", "revoke")]
        self.assertEqual(grants[0], ("user", "grant", "--data-dir", "/data", "bob", "Admin"))
        self.assertEqual(revokes[0], ("user", "revoke", "--data-dir", "/data", "bob", "Admin"))
        self.assert_notice(controller, "已撤销 Admin")

    def test_delete_user_argv(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("user", "delete"), ok(("user", "delete")))
        transport.script(("whoami",), whoami_result())
        controller.delete_user("bob")
        self.drain()

        call = [item for item in transport.calls if item[0][:2] == ("user", "delete")][0]
        self.assertEqual(
            call[0],
            ("user", "delete", "--data-dir", "/data", "--yes", "bob"),
        )
        self.assert_notice(controller, "账户已删除")

    def test_user_action_prompts_login_when_logged_out(self) -> None:
        controller = self.make_controller()
        controller.add_user("bob", "secret")
        self.assertIsNotNone(controller.state.login)


class BackupTest(ControllerTestCase):
    def test_backup_now_success_refreshes_list(self) -> None:
        controller, transport = self.logged_in()
        transport.script(
            ("backup",),
            ok(("backup",), "备份已写入 /data/backups/chat-deepseek-20261126-190000.zip\n"),
        )
        transport.script(("backup", "list"), backup_list_result(BACKUP_ONE))
        controller.backup_now()
        self.drain()

        self.assert_notice(controller, "备份完成")
        self.assertEqual(len(controller.state.backups), 1)
        self.assertEqual(controller.state.backups[0].name, BACKUP_ONE[0])
        lists = [argv for argv in transport.argv_calls if argv[:2] == ("backup", "list")]
        self.assertEqual(len(lists), 2)

    def test_backup_requires_owner(self) -> None:
        controller, transport = self.logged_in(groups=("Admin",))
        controller.backup_now()
        self.drain()

        self.assert_notice(controller, "需要 Owner 权限")
        self.assertEqual(transport.calls_for("backup"), [])

    def test_backup_as_remote_is_hidden(self) -> None:
        target = remote_target()
        transport = FakeTransport(target)
        controller = self.make_controller(transport=transport, target=target)
        controller.backup_as("/tmp/out.zip")

        notice = controller.state.notice
        self.assertIsNotNone(notice)
        assert notice is not None
        self.assertIn("远端备份写到远端配置的备份地址", notice.text)
        self.assertEqual(transport.calls, [])

    def test_restore_without_selection_shows_reason(self) -> None:
        controller, transport = self.logged_in()
        controller.restore_backup("chat-deepseek-20261126-180000.zip")
        self.drain()

        self.assert_notice(controller, "先选择一个备份")

    def test_restore_success_clears_state_and_rereads_info(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("backup", "list"), backup_list_result(BACKUP_ONE))
        controller.refresh_backups()
        self.drain()
        controller.select_backup(BACKUP_ONE[0])
        transport.script(("backup", "restore"), ok(("backup", "restore")))
        transport.script(("info",), info_result(data_dir="/data"))
        controller.restore_backup(BACKUP_ONE[0])
        self.drain()

        self.assertIsNone(controller.state.identity)
        # 清态后重读 info，所以最终 hosts 里是恢复后新库的快照。
        self.assertIn(controller.state.target.key, controller.state.hosts)
        self.assertEqual(controller.state.users, ())
        self.assertEqual(controller.state.backups, ())
        self.assertIsNone(controller.state.foreground)
        self.assert_notice(
            controller, "备份已恢复（2026-11-26 18:00:00），请重新登录并启动服务"
        )
        self.assertTrue(
            any(argv[:2] == ("backup", "restore") for argv in transport.argv_calls)
        )
        self.assertTrue(
            any(argv[:1] == ("info",) for argv in transport.argv_calls)
        )


class ServiceTest(ControllerTestCase):
    def bootstrapped(self, **info: object) -> tuple[Controller, FakeTransport]:
        transport = FakeTransport(self.target)
        transport.script(("info",), info_result(**info))
        controller = self.make_controller(transport=transport)
        controller.bootstrap()
        self.drain()
        return controller, transport

    def test_systemd_start_does_not_write_optimistic_state(self) -> None:
        controller, transport = self.bootstrapped(service_installed=True, service_active=False)
        transport.script(("service", "start"), ok(("service", "start")))
        transport.script(("info",), info_result(service_installed=True, service_active=True))
        controller.start_service()

        host = controller.state.hosts[controller.state.target.key]
        self.assertFalse(host.service.active)
        self.drain()

        host = controller.state.hosts[controller.state.target.key]
        self.assertTrue(host.service.active)
        self.assert_notice(controller, "服务已启动")
        self.assertEqual(
            [argv[0] for argv in transport.argv_calls][-2:],
            ["service", "info"],
        )

    def test_systemd_stop_rereads_info(self) -> None:
        controller, transport = self.bootstrapped(service_installed=True, service_active=True)
        transport.script(("service", "stop"), ok(("service", "stop")))
        transport.script(("info",), info_result(service_installed=True, service_active=False))
        controller.stop_service()
        self.drain()

        self.assert_notice(controller, "服务已停止")
        self.assertTrue(
            any(argv[:2] == ("service", "stop") for argv in transport.argv_calls)
        )

    def test_systemd_restart_rereads_info(self) -> None:
        controller, transport = self.bootstrapped(service_installed=True, service_active=True)
        transport.script(("service", "restart"), ok(("service", "restart")))
        transport.script(("info",), info_result(service_installed=True, service_active=True))
        controller.restart_service()
        self.drain()

        self.assert_notice(controller, "服务已重启")
        self.assertTrue(
            any(argv[:2] == ("service", "restart") for argv in transport.argv_calls)
        )

    def test_service_failure_refreshes_info_then_dialog(self) -> None:
        controller, transport = self.bootstrapped(service_installed=True, service_active=False)
        transport.script(
            ("service", "start"),
            failure(("service", "start"), 1, "address already in use"),
        )
        transport.script(("info",), info_result(service_installed=True, service_active=False))
        controller.start_service()
        self.drain()

        self.assert_dialog(controller, "端口已被占用")
        self.assertEqual(
            len([argv for argv in transport.argv_calls if argv[0] == "info"]), 2
        )

    def test_foreground_start_logs_change_phase(self) -> None:
        controller, transport = self.bootstrapped(service_installed=False)
        controller.start_service()
        self.assertEqual(len(transport.handles), 1)
        handle = transport.handles[0]
        self.assertEqual(controller.state.foreground.phase.value, "starting")

        handle.emit("正在监听 127.0.0.1:8090")
        self.drain()
        foreground = controller.state.foreground
        self.assertIsNotNone(foreground)
        assert foreground is not None
        self.assertEqual(foreground.phase.value, "running")
        self.assertEqual(foreground.address, "127.0.0.1:8090")
        self.assertEqual(len(foreground.tail), 1)

        handle.emit("打开：http://127.0.0.1:8090")
        self.drain()
        foreground = controller.state.foreground
        assert foreground is not None
        self.assertEqual(foreground.url, "http://127.0.0.1:8090")

        handle.emit("正在关闭服务")
        self.drain()
        foreground = controller.state.foreground
        assert foreground is not None
        self.assertEqual(foreground.phase.value, "stopping")

    def test_foreground_stop_clears_on_exit(self) -> None:
        controller, transport = self.bootstrapped(service_installed=False)
        controller.start_service()
        handle = transport.handles[0]
        handle.emit("正在监听 127.0.0.1:8090")
        self.drain()

        controller.stop_service()
        self.assertEqual(handle.stops, [(False, 5.0)])
        self.drain()

        self.assertIsNone(controller.state.foreground)
        self.assert_notice(controller, "服务已停止")

    def test_foreground_unexpected_exit_reports_failure(self) -> None:
        controller, transport = self.bootstrapped(service_installed=False)
        controller.start_service()
        handle = transport.handles[0]
        handle.emit("错误：监听 127.0.0.1:8090 失败：address already in use")
        self.drain()
        handle.finish(1)
        self.drain()

        self.assertIsNone(controller.state.foreground)
        self.assert_dialog(controller, "端口已被占用")

    def test_foreground_start_rejected_while_busy(self) -> None:
        transport = FakeTransport(self.target)
        hold = transport.hold()
        transport.script(("info",), info_result(service_installed=False))
        controller = self.make_controller(transport=transport)
        controller.bootstrap()
        wait_until(lambda: TaskKey.INFO in controller.state.inflight)

        controller.start_service()
        self.assert_notice(controller, BUSY_TEXT)
        self.assertEqual(transport.handles, [])

        hold.set()
        transport.release()
        self.drain()

    def test_install_with_start_runs_service_start_then_info(self) -> None:
        controller, transport = self.bootstrapped(service_installed=False)
        transport.script(("service", "install"), ok(("service", "install")))
        transport.script(("service", "start"), ok(("service", "start")))
        transport.script(("info",), info_result(service_installed=True, service_active=True))
        controller.install_service(
            {"scope": "user", "enable": True, "start": True, "force": False}
        )
        self.drain()

        verbs = self.verbs(transport)
        self.assertIn(("service", "install"), verbs)
        self.assertIn(("service", "start"), verbs)
        self.assertIn(("info",), verbs)
        self.assert_notice(controller, "服务已启动")
        install = [
            argv for argv in transport.argv_calls if argv[:2] == ("service", "install")
        ][0]
        self.assertIn("--enable", install)
        self.assertIn("--data-dir", install)

    def test_install_without_start_only_rereads_info(self) -> None:
        controller, transport = self.bootstrapped(service_installed=False)
        transport.script(("service", "install"), ok(("service", "install")))
        transport.script(("info",), info_result(service_installed=True, service_active=False))
        controller.install_service({"scope": "user", "start": False})
        self.drain()

        self.assert_notice(controller, "服务已安装，尚未启动")
        self.assertNotIn(("service", "start"), [argv[:2] for argv in transport.argv_calls])

    def test_update_with_start_uses_restart(self) -> None:
        controller, transport = self.bootstrapped(service_installed=True, service_active=True)
        transport.script(("service", "install"), ok(("service", "install")))
        transport.script(("service", "restart"), ok(("service", "restart")))
        transport.script(("info",), info_result(service_installed=True, service_active=True))
        controller.update_service({"enable": False, "start": True})
        self.drain()

        install = [
            argv for argv in transport.argv_calls if argv[:2] == ("service", "install")
        ][0]
        self.assertIn("--disable", install)
        self.assertIn("--force", install)
        self.assertIn(("service", "restart"), [argv[:2] for argv in transport.argv_calls])
        self.assert_notice(controller, "服务已重启")

    def test_update_without_start_notice(self) -> None:
        controller, transport = self.bootstrapped(service_installed=True, service_active=True)
        transport.script(("service", "install"), ok(("service", "install")))
        transport.script(("info",), info_result(service_installed=True, service_active=True))
        controller.update_service({"enable": True, "start": False})
        self.drain()

        self.assert_notice(
            controller, "systemd unit 已更新；未启动或重启服务。"
        )

    def test_uninstall_rereads_info(self) -> None:
        controller, transport = self.bootstrapped(service_installed=True, service_active=False)
        transport.script(("service", "uninstall"), ok(("service", "uninstall")))
        transport.script(("info",), info_result(service_installed=False))
        controller.uninstall_service()
        self.drain()

        self.assert_notice(controller, "服务已卸载，数据目录未改动")
        self.assertIn(("service", "uninstall"), [argv[:2] for argv in transport.argv_calls])


class TargetTest(ControllerTestCase):
    def make_binary(self) -> tuple[Path, Path, Path]:
        binary_dir = self.tmp / "bin"
        binary_dir.mkdir()
        binary = binary_dir / "chat-deepseek"
        binary.write_text("#!/bin/sh\n", encoding="utf-8")
        binary.chmod(0o755)
        data_one = self.tmp / "data-one"
        data_two = self.tmp / "data-two"
        data_one.mkdir()
        data_two.mkdir()
        return binary_dir, data_one, data_two

    def test_apply_target_order_and_state(self) -> None:
        binary_dir, data_one, data_two = self.make_binary()
        endpoint_one = Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir=str(binary_dir),
            data_dir=str(data_one),
        )
        first = resolve_target(endpoint_one)
        transport_one = FakeTransport(first)
        transport_one.script(("info",), info_result(data_dir=str(data_one)))
        self.script_login(transport_one)
        transport_one.script(("logout",), ok(("logout",)))
        transport_one.script(("info",), info_result(data_dir=str(data_one)))

        second_endpoint = Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir=str(binary_dir),
            data_dir=str(data_two),
        )
        second = resolve_target(second_endpoint)
        transport_two = FakeTransport(second)
        transport_two.script(("info",), info_result(data_dir=str(data_two)))
        created: list[Target] = []

        def factory(target: Target) -> FakeTransport:
            created.append(target)
            return transport_two

        controller = self.make_controller(
            transport=transport_one, target=first, factory=factory
        )
        controller.bootstrap()
        self.drain()
        controller.login("alice", "pw")
        self.drain()
        controller.start_service()
        self.drain()
        handle = transport_one.handles[0]
        handle.emit("正在监听 127.0.0.1:8090")
        self.drain()

        controller.apply_target(second_endpoint)
        self.drain()

        self.assertEqual(created, [second])
        self.assertTrue(handle.stops)
        self.assertGreaterEqual(transport_one.closed, 1)
        logout_calls = transport_one.calls_for("logout")
        self.assertEqual(len(logout_calls), 1)
        self.assertIn("--data-dir", logout_calls[0])
        self.assertIn(str(data_one), logout_calls[0])
        self.assertEqual(controller.state.target.key, second.key)
        self.assertIsNone(controller.state.identity)
        host = controller.state.hosts[second.key]
        self.assertEqual(host.data_dir, str(data_two))
        saved = gui_config.load(self.config_path)
        self.assertEqual(saved.local.data_dir, str(data_two))
        self.assertTrue(transport_two.argv_calls)

        # 切目标后旧 serve 的迟到日志/退出必须被丢弃。
        handle.emit("正在监听 127.0.0.1:9999")
        handle.finish(1)
        self.drain()
        self.assertIsNone(controller.state.foreground)
        self.assertIn("连接已切换", controller.state.notice.text)

    def test_apply_target_validation_failure_keeps_old(self) -> None:
        controller = self.make_controller()
        endpoint = Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir=str(self.tmp / "missing"),
            data_dir=str(self.tmp / "data"),
        )
        controller.apply_target(endpoint)

        self.assertEqual(controller.state.target.key, self.target.key)
        self.assert_dialog(controller, "chat-deepseek")

    def test_apply_target_factory_failure_keeps_old(self) -> None:
        controller = self.make_controller(factory=lambda _target: (_ for _ in ()).throw(RuntimeError("boom")))
        endpoint = Endpoint(
            kind=ConnectionKind.SSH,
            host="nas",
            binary_dir="/opt",
            data_dir="",
        )
        controller.apply_target(endpoint)

        self.assertEqual(controller.state.target.key, self.target.key)
        self.assert_dialog(controller, "chat-deepseek")
        self.assertIn("boom", controller.state.notice.text)

    def test_apply_target_config_save_failure_keeps_old(self) -> None:
        binary_dir, data_one, _data_two = self.make_binary()
        first = resolve_target(
            Endpoint(
                kind=ConnectionKind.LOCAL,
                binary_dir=str(binary_dir),
                data_dir=str(data_one),
            )
        )
        transport_one = FakeTransport(first)
        transport_one.script(("info",), info_result(data_dir=str(data_one)))
        second_endpoint = Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir=str(binary_dir),
            data_dir=str(self.tmp / "data-two"),
        )
        second = resolve_target(second_endpoint)
        transport_two = FakeTransport(second)
        bad_path = self.tmp / "config-dir"
        bad_path.mkdir()
        controller = self.make_controller(
            transport=transport_one,
            target=first,
            factory=lambda _target: transport_two,
            config_path=bad_path,
        )
        controller.bootstrap()
        self.drain()

        controller.apply_target(second_endpoint)
        self.drain()

        self.assertEqual(controller.state.target.key, first.key)
        self.assertEqual(transport_one.closed, 0)
        self.assertEqual(transport_one.calls_for("logout"), [])
        self.assertGreaterEqual(transport_two.closed, 1)
        self.assert_dialog(controller, "保存设置失败")

    def test_apply_target_save_failure_leaves_old_transport_and_target(self) -> None:
        binary_dir, data_one, _data_two = self.make_binary()
        first = resolve_target(
            Endpoint(
                kind=ConnectionKind.LOCAL,
                binary_dir=str(binary_dir),
                data_dir=str(data_one),
            )
        )
        old_transport = FakeTransport(first)
        new_endpoint = Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir=str(binary_dir),
            data_dir=str(self.tmp / "data-two"),
        )
        new_target = resolve_target(new_endpoint)
        new_transport = FakeTransport(new_target)
        bad_path = self.tmp / "config-file-is-a-dir"
        bad_path.mkdir()
        controller = self.make_controller(
            transport=old_transport,
            target=first,
            factory=lambda _target: new_transport,
            config_path=bad_path,
        )

        controller.apply_target(new_endpoint)
        self.drain()

        self.assertEqual(controller.state.target.key, first.key)
        self.assertEqual(old_transport.closed, 0)
        self.assertEqual(old_transport.calls, [])
        self.assertGreaterEqual(new_transport.closed, 1)
        self.assert_dialog(controller, "保存设置失败")
        self.assertEqual(gui_config.load(bad_path), gui_config.Config())

    def test_apply_target_same_key_saves_config_only(self) -> None:
        binary_dir, data_one, _data_two = self.make_binary()
        endpoint = Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir=str(binary_dir),
            data_dir=str(data_one),
        )
        target = resolve_target(endpoint)
        transport = FakeTransport(target)
        controller = self.make_controller(transport=transport, target=target)
        controller.apply_target(endpoint)
        self.drain()

        self.assertEqual(controller.state.target.key, target.key)
        self.assert_notice(controller, "设置已保存")
        self.assertEqual(transport.calls, [])
        saved = gui_config.load(self.config_path)
        self.assertEqual(saved.local.data_dir, str(data_one))

    def test_test_connection_uses_temporary_transport(self) -> None:
        binary_dir, data_one, _data_two = self.make_binary()
        endpoint = Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir=str(binary_dir),
            data_dir=str(data_one),
        )
        temporary = FakeTransport(resolve_target(endpoint))
        controller = self.make_controller(factory=lambda _target: temporary)
        controller.test_connection(endpoint)
        self.drain()

        self.assertEqual(temporary.verified, [20.0])
        self.assertGreaterEqual(temporary.closed, 1)
        self.assertEqual(controller.state.target.key, self.target.key)
        self.assert_notice(controller, "连接正常")

    def test_test_connection_failure_does_not_expire_current_login(self) -> None:
        transport = FakeTransport(self.target)
        self.script_login(transport)
        temporary = FakeTransport(remote_target())
        temporary.verify_error = CommandError(
            ErrorKind.TRANSPORT,
            parsing.Failure("SSH 连接失败", "无法建立通道", "boom"),
        )
        controller = self.make_controller(
            transport=transport, factory=lambda _target: temporary
        )
        controller.login("alice", "pw")
        self.drain()
        endpoint = Endpoint(
            kind=ConnectionKind.SSH,
            host="nas",
            binary_dir="/opt",
            data_dir="",
        )
        controller.test_connection(endpoint)
        self.drain()

        self.assertIsNotNone(controller.state.identity)
        self.assertEqual(transport.closed, 0)
        self.assert_dialog(controller, "SSH 连接失败")


class SettingsTest(ControllerTestCase):
    def bootstrapped(self, **info: object) -> tuple[Controller, FakeTransport]:
        transport = FakeTransport(self.target)
        transport.script(("info",), info_result(**info))
        controller = self.make_controller(transport=transport)
        controller.bootstrap()
        self.drain()
        return controller, transport

    def test_save_server_config_only_writes_changed_items(self) -> None:
        controller, transport = self.bootstrapped()
        transport.script(("config", "set"), ok(("config", "set")))
        transport.script(("info",), info_result(backup_dir="/new"))
        controller.save_server_config(
            {
                "backup_dir": "/new",
                "listen": "127.0.0.1:8090",
                "public_url": "",
                "api_origin": "https://api.deepseek.com",
            }
        )
        self.drain()

        sets = [argv for argv in transport.argv_calls if argv[:2] == ("config", "set")]
        self.assertEqual(
            sets,
            [("config", "set", "backup_dir", "/new", "--data-dir", "/data")],
        )
        self.assert_notice(controller, "设置已保存")

    def test_save_server_config_without_changes(self) -> None:
        controller, transport = self.bootstrapped()
        controller.save_server_config(
            {
                "backup_dir": "/data/backups",
                "listen": "127.0.0.1:8090",
                "public_url": "",
                "api_origin": "https://api.deepseek.com",
            }
        )
        self.drain()

        self.assert_notice(controller, "没有需要保存的修改")
        self.assertEqual(transport.calls_for("config"), [])

    def test_save_server_config_waits_for_info(self) -> None:
        controller = self.make_controller()
        controller.save_server_config({"listen": "127.0.0.1:9000"})
        self.assert_notice(controller, "正在读取目标主机配置…")


class MiscTest(ControllerTestCase):
    def test_show_help_opens_dialog_with_output(self) -> None:
        controller, transport = self.logged_in()
        transport.script(("help",), ok(("help",), "用法：chat-deepseek ...\n"))
        controller.show_help()
        self.drain()

        notice = controller.state.notice
        self.assertIsNotNone(notice)
        assert notice is not None
        self.assertTrue(notice.dialog)
        self.assertEqual(notice.title, "命令行提示")
        self.assertIn("用法", notice.details)

    def test_set_page_and_dismiss_notice(self) -> None:
        controller = self.make_controller()
        controller.set_page("accounts")
        self.assertIs(controller.state.page, PageId.ACCOUNTS)
        controller.dismiss_notice()
        self.assertIsNone(controller.state.notice)

    def test_config_reflects_latest_saved_username(self) -> None:
        transport = FakeTransport(self.target)
        self.script_login(transport)
        config = gui_config.Config(
            connection="local",
            local=gui_config.LocalConfig(
                binary_dir="/opt", data_dir="/data", username="old"
            ),
            ssh=gui_config.SshConfig(
                host="nas", binary_dir="/opt", data_dir="", username="nasuser"
            ),
        )
        controller = self.make_controller(transport=transport, config=config)
        controller.login("alice", "pw")
        self.drain()

        self.assertEqual(controller.config.local.username, "alice")
        self.assertEqual(controller.config.ssh.username, "nasuser")
        self.assertEqual(gui_config.load(self.config_path).local.username, "alice")

    def test_service_user_is_empty_until_remote_connected(self) -> None:
        target = remote_target()
        transport = SshTransport(target, program="ssh")
        controller = self.make_controller(transport=transport, target=target)

        self.assertEqual(controller.service_user, "")
        transport.session.remote_user = "nasuser"
        self.assertEqual(controller.service_user, "nasuser")

    def test_apply_target_remote_writes_ssh_config(self) -> None:
        endpoint = Endpoint(
            kind=ConnectionKind.SSH,
            host="nas",
            binary_dir="/opt/chat-deepseek",
            data_dir="/srv/data",
        )
        transport = FakeTransport(remote_target())
        transport.script(("info",), info_result(data_dir="/srv/data"))
        controller = self.make_controller(factory=lambda _target: transport)
        controller.apply_target(endpoint)
        self.drain()

        saved = gui_config.load(self.config_path)
        self.assertEqual(saved.connection, "ssh")
        self.assertEqual(saved.ssh.host, "nas")
        self.assertEqual(saved.ssh.data_dir, "/srv/data")


class ShutdownTest(ControllerTestCase):
    def test_shutdown_order_and_no_callbacks_after(self) -> None:
        controller, transport = self.logged_in()
        controller.start_service()
        self.drain()
        self.assertEqual(len(transport.handles), 1)
        handle = transport.handles[0]

        controller.shutdown()

        self.assertTrue(controller.state.closing)
        self.assertIs(controller.state.phase, Phase.CLOSING)
        self.assertEqual(len(handle.stops), 1)
        self.assertEqual(handle.stops[0][1], 8.0)
        self.assertEqual(len(transport.calls_for("logout")), 1)
        self.assertGreaterEqual(transport.closed, 1)
        self.assertTrue(self.pump.closed)

        calls_before = len(transport.calls)
        controller.login("alice", "pw")
        controller.show_help()
        controller.set_page(PageId.SETTINGS)
        self.drain()
        self.assertEqual(len(transport.calls), calls_before)
        self.assertIs(controller.state.page, PageId.SERVICE)

    def test_shutdown_without_login_skips_logout(self) -> None:
        transport = FakeTransport(self.target)
        controller = self.make_controller(transport=transport)
        controller.shutdown()
        self.assertEqual(transport.calls_for("logout"), [])
        self.assertGreaterEqual(transport.closed, 1)


if __name__ == "__main__":
    unittest.main()
