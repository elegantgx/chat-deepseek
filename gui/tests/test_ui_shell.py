"""C5b 窗口骨架测试：FakeController、导航、泵、notice、登录 sheet、关闭。"""

from __future__ import annotations

import os
import sys
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtCore import Qt
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication

import gui_config
import parsing
import theme
from cdgui.domain import reducers
from cdgui.domain.facts import (
    ForegroundPhase,
    ForegroundSession,
    HostConfig,
    ServiceStatus,
)
from cdgui.domain.rules import ActionId
from cdgui.domain.state import (
    AppState,
    InflightEntry,
    LoginPrompt,
    Notice,
    NoticeTone,
    PageId,
    TaskKey,
)
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.ui import main_window as main_window_module
from cdgui.ui.main_window import MainWindow
from cdgui.ui.primitives import Button
from cdgui.ui.protocols import ControllerProtocol
from cdgui.ui.views import (
    COMPACT_BREAKPOINT,
    NAV_ROW_HEIGHT,
    NAV_WIDTH,
    STATUS_BAR_HEIGHT,
    TOP_BAR_HEIGHT,
)

NOW = datetime(2026, 11, 26, 12, 0, 0)


def local_target(data_dir: str = "/home/gx/chat-deepseek/data") -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir="/opt/chat-deepseek",
            data_dir=data_dir,
        ),
        binary="/opt/chat-deepseek/chat-deepseek",
        data_dir=data_dir,
    )


def host_for(
    target: Target,
    *,
    initialized: bool = True,
    installed: bool = False,
    active: bool = False,
) -> HostConfig:
    if active:
        installed = True
    return HostConfig(
        target_key=target.key,
        version="0.1.4",
        os="linux",
        arch="amd64",
        initialized=initialized,
        listen="127.0.0.1:8090",
        public_url="",
        api_origin="",
        backup_dir="",
        service=ServiceStatus(
            supported=True, installed=installed, active=active
        ),
        data_dir=target.data_dir or "/srv/chat-deepseek/data",
    )


def identity(
    username: str = "gx",
    groups: tuple[str, ...] = ("Owner",),
    minutes: int = 12,
) -> parsing.Identity:
    return parsing.Identity(
        username=username,
        groups=groups,
        expires_at=NOW + timedelta(minutes=minutes),
    )


def default_state(**overrides) -> AppState:
    target = local_target()
    state = AppState(
        target=target, hosts={target.key: host_for(target)}
    )
    if overrides:
        state = replace(state, **overrides)
    return state


class FakePump:
    def __init__(self) -> None:
        self.drains = 0
        self.callbacks: list[object] = []

    def drain(self) -> int:
        self.drains += 1
        callbacks, self.callbacks = self.callbacks, []
        for callback in callbacks:
            callback()
        return len(callbacks)


class FakeController:
    """实现 ControllerProtocol 的窗口测试替身；每个调用都记录。"""

    def __init__(self, state: AppState) -> None:
        self._state = state
        self.pump = FakePump()
        self.listeners: list = []
        self.calls: list[tuple[str, tuple, dict]] = []
        self.unsubscribed = 0

    @property
    def state(self) -> AppState:
        return self._state

    @property
    def config(self) -> gui_config.Config:
        return gui_config.Config()

    @property
    def service_user(self) -> str:
        return "gx"

    def set_state(self, state: AppState, *, notify: bool = True) -> None:
        self._state = state
        if notify:
            self._notify()

    def _notify(self) -> None:
        for listener in list(self.listeners):
            listener(self._state)

    def _record(self, name: str, *args, **kwargs) -> None:
        self.calls.append((name, args, kwargs))

    def names(self) -> list[str]:
        return [call[0] for call in self.calls]

    def subscribe(self, listener):
        self.listeners.append(listener)

        def unsubscribe() -> None:
            self.unsubscribed += 1
            if listener in self.listeners:
                self.listeners.remove(listener)

        return unsubscribe

    def set_page(self, page: PageId | str) -> None:
        self._record("set_page", page)
        self.set_state(reducers.set_page(self._state, page))

    def dismiss_notice(self) -> None:
        self._record("dismiss_notice")
        if self._state.notice is not None:
            self.set_state(replace(self._state, notice=None))

    def ensure_login(self, then=None) -> bool:
        self._record("ensure_login", then)
        if self._state.identity is None:
            self.set_state(
                replace(self._state, login=LoginPrompt(username="gx"))
            )
            return False
        return True

    def login(self, username, password, then=None) -> None:
        self._record("login", username, password, then)

    def logout(self) -> None:
        self._record("logout")
        self.set_state(
            replace(
                self._state,
                identity=None,
                users=(),
                backups=(),
                selected=None,
                selected_backup=None,
            )
        )

    def refresh_users(self) -> None:
        self._record("refresh_users")

    def select_user(self, username) -> None:
        self._record("select_user", username)

    def setup_owner(self, username, password) -> None:
        self._record("setup_owner", username, password)

    def add_user(self, username, password, groups=()) -> None:
        self._record("add_user", username, password, groups)

    def reset_password(self, username, password) -> None:
        self._record("reset_password", username, password)

    def set_user_enabled(self, username, enabled) -> None:
        self._record("set_user_enabled", username, enabled)

    def change_group(self, username, group, add: bool) -> None:
        self._record("change_group", username, group, add)

    def delete_user(self, username) -> None:
        self._record("delete_user", username)

    def refresh_backups(self) -> None:
        self._record("refresh_backups")

    def select_backup(self, name) -> None:
        self._record("select_backup", name)

    def backup_now(self) -> None:
        self._record("backup_now")

    def backup_as(self, path) -> None:
        self._record("backup_as", path)

    def restore_backup(self, name) -> None:
        self._record("restore_backup", name)

    def start_service(self) -> None:
        self._record("start_service")

    def stop_service(self) -> None:
        self._record("stop_service")

    def restart_service(self) -> None:
        self._record("restart_service")

    def install_service(self, options) -> None:
        self._record("install_service", options)

    def update_service(self, options) -> None:
        self._record("update_service", options)

    def uninstall_service(self) -> None:
        self._record("uninstall_service")

    def test_connection(self, endpoint) -> None:
        self._record("test_connection", endpoint)

    def apply_target(self, endpoint) -> None:
        self._record("apply_target", endpoint)

    def save_server_config(self, values) -> None:
        self._record("save_server_config", values)

    def show_help(self) -> None:
        self._record("show_help")

    def shutdown(self) -> None:
        self._record("shutdown")


class FakeDialogs:
    def __init__(self, confirm: bool = True) -> None:
        self.confirm = confirm
        self.ask_calls: list[tuple] = []
        self.messages: list[tuple] = []

    def ask_confirm(self, parent, title, message, danger=False):
        self.ask_calls.append((title, message, danger))
        return self.confirm

    def show_message(self, parent, title, message, details=None):
        self.messages.append((title, message, details))


class ShellTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        self._dark_hint = theme._dark_hint
        theme._dark_hint = False
        self._original_dialogs = main_window_module.dialogs
        self.window: MainWindow | None = None
        self.controller: FakeController | None = None

    def tearDown(self) -> None:
        theme._dark_hint = self._dark_hint
        if self.window is not None:
            main_window_module.dialogs = FakeDialogs(confirm=True)
            self.window.close()
            self.window.deleteLater()
        main_window_module.dialogs = self._original_dialogs
        self.app.processEvents()

    def make_window(
        self, state: AppState | None = None, *, show: bool = True
    ) -> tuple[MainWindow, FakeController]:
        controller = FakeController(state or default_state())
        window = MainWindow(controller)
        self.window = window
        self.controller = controller
        if show:
            window.show()
            window.activateWindow()
            self.app.processEvents()
        return window, controller

    def settle(self) -> None:
        self.app.processEvents()
        self.app.processEvents()

    # -- 骨架 --------------------------------------------------------------

    def test_window_dimensions_and_fixed_shell_metrics(self) -> None:
        window, _ = self.make_window()
        self.assertEqual(window.windowTitle(), "chat-deepseek")
        self.assertEqual(window.size().width(), 1000)
        self.assertEqual(window.size().height(), 760)
        self.assertEqual(window.minimumWidth(), 900)
        self.assertEqual(window.minimumHeight(), 740)
        self.assertEqual(window.views.top_bar.height(), TOP_BAR_HEIGHT)
        self.assertEqual(window.views.nav_panel.width(), NAV_WIDTH)
        self.assertEqual(
            window.views.nav_buttons[PageId.SERVICE].height(), NAV_ROW_HEIGHT
        )
        self.assertEqual(
            window.views.status_bar.height(), STATUS_BAR_HEIGHT
        )

    def test_fake_controller_satisfies_protocol(self) -> None:
        controller = FakeController(default_state())
        self.assertIsInstance(controller, ControllerProtocol)

    def test_nav_buttons_switch_pages(self) -> None:
        window, controller = self.make_window()
        window.views.nav_buttons[PageId.ACCOUNTS].click()
        self.settle()

        self.assertEqual(controller.state.page, PageId.ACCOUNTS)
        self.assertIn(("set_page", (PageId.ACCOUNTS,), {}), controller.calls)
        self.assertIs(
            window.views.stacked.currentWidget(),
            window.views.pages[PageId.ACCOUNTS].widget,
        )
        self.assertTrue(
            window.views.nav_buttons[PageId.ACCOUNTS].is_selected()
        )
        self.assertFalse(
            window.views.nav_buttons[PageId.SERVICE].is_selected()
        )

    def test_ctrl_number_shortcuts_switch_pages(self) -> None:
        window, controller = self.make_window()
        expected = [
            PageId.SERVICE,
            PageId.ACCOUNTS,
            PageId.BACKUPS,
            PageId.SETTINGS,
        ]
        for index, page_id in enumerate(expected, start=1):
            QTest.keyClick(window, getattr(Qt.Key, f"Key_{index}"), Qt.ControlModifier)
            self.settle()
            self.assertEqual(controller.state.page, page_id, page_id)
            self.assertIs(
                window.views.stacked.currentWidget(),
                window.views.pages[page_id].widget,
            )

    def test_ctrl_comma_opens_settings(self) -> None:
        window, controller = self.make_window()
        QTest.keyClick(window, Qt.Key.Key_Comma, Qt.ControlModifier)
        self.settle()

        self.assertEqual(controller.state.page, PageId.SETTINGS)
        self.assertIs(
            window.views.stacked.currentWidget(),
            window.views.pages[PageId.SETTINGS].widget,
        )

    def test_target_chip_menu_hands_off_to_settings(self) -> None:
        window, controller = self.make_window()
        menu = window.views.target_chip.build_menu()
        self.assertEqual([action.text() for action in menu.actions()], ["切换目标…"])
        menu.actions()[0].trigger()
        self.settle()

        self.assertEqual(controller.state.page, PageId.SETTINGS)
        self.assertIn("set_page", controller.names())
        menu.deleteLater()

    def test_service_chip_and_status_backup_navigate(self) -> None:
        window, controller = self.make_window()
        window._request_page(PageId.SETTINGS)
        self.settle()
        window.views.service_chip.clicked.emit()
        self.settle()
        self.assertEqual(controller.state.page, PageId.SERVICE)

        window.views.status_backup.click()
        self.settle()
        self.assertEqual(controller.state.page, PageId.BACKUPS)

    def test_help_button_calls_show_help(self) -> None:
        window, controller = self.make_window()
        window.views.status_help.click()
        self.settle()
        self.assertIn("show_help", controller.names())

    # -- 渲染 / notice -----------------------------------------------------

    def test_notice_toast_then_dismiss(self) -> None:
        window, controller = self.make_window()
        controller.set_state(
            replace(
                controller.state,
                notice=Notice("登录已过期，请重新登录", tone=NoticeTone.WARNING),
            )
        )
        self.settle()

        self.assertEqual(
            window.views.toast.text(), "登录已过期，请重新登录"
        )
        self.assertTrue(window.views.toast.isVisible())
        self.assertEqual(controller.names().count("dismiss_notice"), 1)
        self.assertIsNone(controller.state.notice)

        controller.set_state(
            replace(controller.state, notice=None)
        )
        self.settle()
        self.assertEqual(controller.names().count("dismiss_notice"), 1)

    def test_dialog_notice_uses_show_message(self) -> None:
        window, controller = self.make_window()
        dialogs = FakeDialogs()
        main_window_module.dialogs = dialogs
        notice = Notice(
            "登录已失效",
            tone=NoticeTone.ERROR,
            title="登录",
            details="exit 3",
            dialog=True,
        )
        controller.set_state(replace(controller.state, notice=notice))
        self.settle()

        self.assertEqual(dialogs.messages, [("登录", "登录已失效", "exit 3")])
        self.assertEqual(controller.names().count("dismiss_notice"), 1)

    def test_busy_disables_registered_action_button(self) -> None:
        window, controller = self.make_window()
        button = Button("启动服务", kind="primary")
        window.views.register_button(ActionId.START, button)
        window._render()
        self.assertTrue(button.isEnabled())

        target = controller.state.target
        busy = {
            TaskKey.INFO: InflightEntry(TaskKey.INFO, target.key, 1)
        }
        controller.set_state(replace(controller.state, inflight=busy))
        self.settle()

        self.assertFalse(button.isEnabled())
        self.assertEqual(button.toolTip(), "正在执行上一条命令")

    def test_pump_timer_drains_and_renders(self) -> None:
        window, controller = self.make_window()
        self.assertEqual(window._pump_timer.interval(), 30)
        controller.set_state(
            reducers.set_page(controller.state, PageId.BACKUPS), notify=False
        )
        window._drain()
        self.assertEqual(controller.pump.drains, 1)
        self.settle()
        self.assertIs(
            window.views.stacked.currentWidget(),
            window.views.pages[PageId.BACKUPS].widget,
        )

    def test_can_leave_blocks_page_switch(self) -> None:
        window, controller = self.make_window()
        window._request_page(PageId.SETTINGS)
        self.settle()
        window.views.pages[PageId.SETTINGS].can_leave = lambda: False

        window.views.nav_buttons[PageId.SERVICE].click()
        self.settle()

        self.assertEqual(controller.state.page, PageId.SETTINGS)
        self.assertIs(
            window.views.stacked.currentWidget(),
            window.views.pages[PageId.SETTINGS].widget,
        )

    def test_narrow_window_hides_brand_and_shortens_target(self) -> None:
        window, _ = self.make_window()
        window.resize(900, 740)
        self.settle()
        self.assertTrue(window.views.brand_text.isHidden())
        self.assertEqual(window.views.target_chip.text(), "本机")

        window.resize(COMPACT_BREAKPOINT + 100, 760)
        self.settle()
        self.assertFalse(window.views.brand_text.isHidden())
        self.assertIn("·", window.views.target_chip.text())

    # -- 登录 --------------------------------------------------------------

    def test_login_sheet_prefills_error_and_submits(self) -> None:
        window, controller = self.make_window()
        prompt = LoginPrompt(username="gx", error="密码错误")
        controller.set_state(replace(controller.state, login=prompt))
        self.settle()

        sheet = window._login_sheet
        self.assertIsNotNone(sheet)
        self.assertEqual(sheet.username(), "gx")
        self.assertEqual(sheet.error_text(), "密码错误")
        sheet.password_field.setText("password123")
        sheet.submit()
        self.settle()

        self.assertIn(
            ("login", ("gx", "password123", None), {}), controller.calls
        )

    def test_login_sheet_close_does_not_reopen(self) -> None:
        window, controller = self.make_window()
        prompt = LoginPrompt(username="gx")
        controller.set_state(replace(controller.state, login=prompt))
        self.settle()
        sheet = window._login_sheet
        self.assertIsNotNone(sheet)

        sheet.reject()
        self.settle()
        self.assertIsNone(window._login_sheet)

        controller.set_state(
            replace(controller.state, login=LoginPrompt(username="gx"))
        )
        self.settle()
        self.assertIsNone(window._login_sheet)

    def test_login_button_calls_ensure_login_and_opens_sheet(self) -> None:
        window, controller = self.make_window()
        window.views.login_button.click()
        self.settle()

        self.assertIn("ensure_login", controller.names())
        self.assertIsNotNone(window._login_sheet)

    def test_logged_in_identity_button_logs_out(self) -> None:
        state = replace(default_state(), identity=identity())
        window, controller = self.make_window(state)
        window.views.login_button.click()
        self.settle()

        self.assertIn("logout", controller.names())
        self.assertIsNone(controller.state.identity)

    # -- 关闭 --------------------------------------------------------------

    def test_close_calls_shutdown_without_service(self) -> None:
        window, controller = self.make_window()
        dialogs = FakeDialogs()
        main_window_module.dialogs = dialogs
        window.close()
        self.settle()

        self.assertEqual(dialogs.ask_calls, [])
        self.assertEqual(controller.names().count("shutdown"), 1)
        self.assertEqual(controller.unsubscribed, 1)

    def test_close_running_service_cancel_then_confirm(self) -> None:
        target = local_target()
        foreground = ForegroundSession(
            target_key=target.key,
            phase=ForegroundPhase.RUNNING,
            address="127.0.0.1:8090",
            url="http://127.0.0.1:8090",
        )
        state = replace(
            default_state(), foreground=foreground
        )
        window, controller = self.make_window(state)
        dialogs = FakeDialogs(confirm=False)
        main_window_module.dialogs = dialogs
        window.close()
        self.settle()

        self.assertEqual(len(dialogs.ask_calls), 1)
        self.assertEqual(controller.names().count("shutdown"), 0)
        self.assertTrue(window.isVisible())

        dialogs.confirm = True
        window.close()
        self.settle()
        self.assertEqual(controller.names().count("shutdown"), 1)


if __name__ == "__main__":
    unittest.main()
