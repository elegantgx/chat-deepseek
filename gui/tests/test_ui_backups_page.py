"""备份页测试（offscreen）：锁定、停机确认、列表、恢复与远端差异。"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QApplication, QWidget

import gui_config
import parsing
import theme
from cdgui.domain.facts import (
    ForegroundPhase,
    ForegroundSession,
    HostConfig,
    ServiceStatus,
)
from cdgui.domain.state import AppState
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.ui.pages import backups as backups_module
from cdgui.ui.pages.backups import BackupsPage
from cdgui.ui.render import derive_ui

NOW = datetime(2026, 11, 26, 12, 0, 0)


def local_target(data_dir: str = "/data") -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir="/opt/chat-deepseek",
            data_dir=data_dir,
        ),
        binary="/opt/chat-deepseek/chat-deepseek",
        data_dir=data_dir,
    )


def remote_target() -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.SSH,
            host="nas",
            binary_dir="/srv/chat-deepseek",
            data_dir="/srv/data",
        ),
        binary="/srv/chat-deepseek/chat-deepseek",
        data_dir="/srv/data",
    )


def host_for(
    target: Target,
    *,
    initialized: bool = True,
    backup_dir: str = "/data/backups",
) -> HostConfig:
    return HostConfig(
        target_key=target.key,
        version="0.1.4",
        os="linux",
        arch="amd64",
        initialized=initialized,
        listen="127.0.0.1:8090",
        public_url="",
        api_origin="https://api.deepseek.com",
        backup_dir=backup_dir,
        service=ServiceStatus(supported=True),
        data_dir=target.data_dir,
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


def backup(name: str = "2026-11-26-120000.zip") -> parsing.Backup:
    return parsing.Backup(
        name=name, size="1.2 MB", time=datetime(2026, 11, 26, 12, 0, 0)
    )


def make_state(
    *,
    target: Target | None = None,
    host: HostConfig | None = ...,
    identity_value: parsing.Identity | None = None,
    backups: tuple[parsing.Backup, ...] | None = None,
    selected_backup: str | None = None,
    foreground: ForegroundSession | None = None,
    info_error: str | None = None,
) -> AppState:
    target = target or local_target()
    if host is ...:
        host = host_for(target)
    if backups is None:
        backups = (backup(),) if identity_value is not None else ()
    hosts = {target.key: host} if host is not None else {}
    return AppState(
        target=target,
        hosts=hosts,
        identity=identity_value,
        backups=backups,
        selected_backup=selected_backup,
        foreground=foreground,
        info_error=info_error,
    )


class FakeController:
    """备份页测试替身；每个动作只记录参数。"""

    def __init__(self, state: AppState) -> None:
        self._state = state
        self.config = gui_config.Config()
        self.calls: list[tuple[str, tuple]] = []

    @property
    def state(self) -> AppState:
        return self._state

    def set_state(self, state: AppState) -> None:
        self._state = state

    def _record(self, name: str, *args) -> None:
        self.calls.append((name, args))

    def names(self) -> list[str]:
        return [name for name, _args in self.calls]

    def ensure_login(self, then=None) -> bool:
        self._record("ensure_login", then)
        return self._state.identity is not None

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

    def stop_service(self) -> None:
        self._record("stop_service")

    def logout(self) -> None:
        self._record("logout")

    def show_help(self) -> None:
        self._record("show_help")


class BackupsPageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        self._dark_hint = theme._dark_hint
        theme._dark_hint = False
        self.host = QWidget()

    def tearDown(self) -> None:
        theme._dark_hint = self._dark_hint
        self.host.close()
        self.host.deleteLater()
        self.app.processEvents()

    def _page(self, state: AppState) -> tuple[BackupsPage, FakeController]:
        controller = FakeController(state)
        page = BackupsPage(controller)
        page.widget.setParent(self.host)
        return page, controller

    def _render(self, page: BackupsPage, state: AppState) -> None:
        page.render(derive_ui(state, NOW), state)

    # -- 锁定 / 权限 -------------------------------------------------------

    def test_logged_out_page_is_locked_with_login_entry(self) -> None:
        state = make_state()
        page, controller = self._page(state)
        self._render(page, state)

        self.assertTrue(page.content.isHidden())
        self.assertFalse(page.lock_view.isHidden())
        self.assertEqual(page.lock_title.text(), "Owner 登录后查看备份")
        page.login_button.click()
        self.assertIn("ensure_login", controller.names())
        self.assertIsNone(controller.calls[0][1][0])

    def test_not_owner_page_requires_owner_login(self) -> None:
        state = make_state(identity_value=identity(groups=("Admin",)))
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertTrue(page.content.isHidden())
        self.assertEqual(page.lock_title.text(), "需要 Owner 登录")
        self.assertIn("Admin", page.lock_hint.text())
        self.assertTrue(page.login_button.isHidden())

    def test_uninitialized_data_prompts_owner_and_disables_login(self) -> None:
        target = local_target()
        state = make_state(
            target=target, host=host_for(target, initialized=False)
        )
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertEqual(page.lock_title.text(), "需要 Owner 登录")
        self.assertIn("初始化", page.lock_hint.text())
        self.assertFalse(page.login_button.isEnabled())

    # -- 头部 --------------------------------------------------------------

    def test_backup_address_shown_and_copy_copies_full_path(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertEqual(page.address_row.text(), "/data/backups")
        page.address_row.copy()
        clipboard = QGuiApplication.clipboard()
        self.assertEqual(clipboard.text(), "/data/backups")

    def test_recent_backup_line_comes_from_ui_state(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)
        self.assertIn("最近备份", page.recent_label.text())
        self.assertIn("2026-11-26 12:00:00", page.recent_label.text())

    def test_backup_buttons_call_controller(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)

        page.backup_now_button.click()
        page.refresh_button.click()
        self.assertEqual(controller.names(), ["backup_now", "refresh_backups"])

    def test_backup_as_remote_is_hidden(self) -> None:
        target = remote_target()
        state = make_state(
            target=target, host=host_for(target, backup_dir="/srv/backups"),
            identity_value=identity(),
        )
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertTrue(page.backup_as_button.isHidden())
        self.assertEqual(page.address_row.text(), "/srv/backups")

    def test_backup_as_local_uses_save_dialog_and_controller(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        with tempfile.TemporaryDirectory() as directory:
            target = str(Path(directory) / "out.zip")
            with mock.patch.object(
                backups_module.QFileDialog,
                "getSaveFileName",
                return_value=(target, "ZIP 备份 (*.zip)"),
            ):
                page.backup_as_button.click()
        self.assertEqual(controller.calls[-1], ("backup_as", (target,)))

    # -- 停机前置条件 ------------------------------------------------------

    def _running_state(self) -> AppState:
        target = local_target()
        foreground = ForegroundSession(
            target_key=target.key,
            phase=ForegroundPhase.RUNNING,
            address="127.0.0.1:8090",
            url="http://127.0.0.1:8090",
        )
        return make_state(
            target=target, identity_value=identity(), foreground=foreground
        )

    def test_running_banner_confirms_before_stopping(self) -> None:
        state = self._running_state()
        page, controller = self._page(state)
        self._render(page, state)

        self.assertFalse(page.precondition.isHidden())
        with mock.patch.object(
            backups_module, "ask_confirm", return_value=True
        ) as confirm:
            page.stop_button.click()
        confirm.assert_called_once()
        self.assertEqual(confirm.call_args.args[1], "停止服务")
        self.assertIn("不会自动重启", confirm.call_args.args[2])
        self.assertTrue(confirm.call_args.kwargs["danger"])
        self.assertEqual(controller.names(), ["stop_service"])

    def test_running_banner_cancel_does_not_stop_service(self) -> None:
        state = self._running_state()
        page, controller = self._page(state)
        self._render(page, state)

        with mock.patch.object(
            backups_module, "ask_confirm", return_value=False
        ):
            page.stop_button.click()
        self.assertEqual(controller.calls, [])

    def test_not_running_hides_precondition_banner(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)
        self.assertTrue(page.precondition.isHidden())

    # -- 列表 --------------------------------------------------------------

    def test_list_rows_show_time_name_and_size(self) -> None:
        archives = (
            backup("2026-11-26-120000.zip"),
            parsing.Backup(
                "2026-11-25-010203.zip",
                "900 KB",
                datetime(2026, 11, 25, 1, 2, 3),
            ),
        )
        state = make_state(identity_value=identity(), backups=archives)
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertEqual(len(page.rows), 2)
        self.assertEqual(page.rows[0].title.text(), "2026-11-26 12:00:00")
        self.assertEqual(page.rows[0].subtitle.full_text(), "2026-11-26-120000.zip")
        self.assertEqual(page.rows[0].trailing.text(), "1.2 MB")
        self.assertTrue(page.empty_widget.isHidden())

    def test_empty_state_is_shown(self) -> None:
        state = make_state(
            identity_value=identity(), backups=(), selected_backup=None
        )
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertEqual(page.rows, [])
        self.assertFalse(page.empty_widget.isHidden())
        self.assertEqual(page.empty_title.text(), "还没有备份")
        self.assertIn("立即备份", page.empty_hint.text())

    def test_click_row_selects_and_highlights(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)

        page.rows[0].clicked.emit()
        self.assertEqual(controller.calls[-1], ("select_backup", ("2026-11-26-120000.zip",)))
        selected = make_state(
            identity_value=identity(),
            backups=state.backups,
            selected_backup="2026-11-26-120000.zip",
        )
        controller.set_state(selected)
        self._render(page, selected)
        self.assertTrue(page.rows[0].is_selected())
        self.assertEqual(page.selection_label.text(), "已选择 2026-11-26-120000.zip")

    def test_list_rebuild_is_idempotent_and_keeps_row_objects(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)
        first = page.rows[0]
        self._render(page, state)
        self.assertIs(page.rows[0], first)
        self.assertEqual(len(page.rows), 1)

    # -- 恢复 --------------------------------------------------------------

    def test_restore_disabled_without_selection(self) -> None:
        state = make_state(
            identity_value=identity(), backups=(), selected_backup=None
        )
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertFalse(page.restore_button.isEnabled())
        self.assertEqual(page.selection_label.text(), "未选择备份")

    def test_restore_confirm_repeats_all_overwritten_files(self) -> None:
        state = make_state(
            identity_value=identity(),
            selected_backup="2026-11-26-120000.zip",
        )
        page, controller = self._page(state)
        self._render(page, state)

        self.assertTrue(page.restore_button.isEnabled())
        with mock.patch.object(
            backups_module, "ask_confirm", return_value=True
        ) as confirm:
            page.restore_button.click()
        message = confirm.call_args.args[2]
        self.assertIn("2026-11-26-120000.zip", message)
        for name in ("chat.db", "config.json", "master.key", "files/"):
            self.assertIn(name, message)
        self.assertTrue(confirm.call_args.kwargs["danger"])
        self.assertEqual(
            controller.calls[-1],
            ("restore_backup", ("2026-11-26-120000.zip",)),
        )

    def test_restore_cancel_does_not_call_controller(self) -> None:
        state = make_state(
            identity_value=identity(),
            selected_backup="2026-11-26-120000.zip",
        )
        page, controller = self._page(state)
        self._render(page, state)

        with mock.patch.object(
            backups_module, "ask_confirm", return_value=False
        ):
            page.restore_button.click()
        self.assertEqual(controller.calls, [])

    # -- 错误 --------------------------------------------------------------

    def test_info_error_is_shown_as_retry_prompt(self) -> None:
        state = make_state(
            identity_value=identity(), info_error="ssh timeout"
        )
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertFalse(page.info_error_panel.isHidden())
        self.assertIn("ssh timeout", page.info_error_label.text())
        self.assertIn("状态读取失败", page.info_error_label.text())
        self.assertIn("重试", page.info_error_label.text())


if __name__ == "__main__":
    unittest.main()
