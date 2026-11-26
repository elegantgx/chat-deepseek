"""设置页测试（offscreen）：草稿、连接校验、服务端配置与登录/关于卡。"""

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

from PySide6.QtWidgets import QApplication, QScrollArea, QWidget

import gui_config
import parsing
import theme
from cdgui.domain.facts import HostConfig, ServiceStatus
from cdgui.domain.state import AppState
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.ui.pages import settings as settings_module
from cdgui.ui.pages.settings import SettingsPage
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
    backup_dir: str = "/data/backups",
    listen: str = "127.0.0.1:8090",
    public_url: str = "",
    api_origin: str = "https://api.deepseek.com",
) -> HostConfig:
    return HostConfig(
        target_key=target.key,
        version="0.1.4",
        os="linux",
        arch="amd64",
        initialized=True,
        listen=listen,
        public_url=public_url,
        api_origin=api_origin,
        backup_dir=backup_dir,
        service=ServiceStatus(supported=True),
        data_dir=target.data_dir,
    )


def identity(
    username: str = "gx",
    groups: tuple[str, ...] = ("Owner",),
) -> parsing.Identity:
    return parsing.Identity(
        username=username,
        groups=groups,
        expires_at=NOW + timedelta(minutes=12),
    )


def make_config(
    *,
    connection: str = "local",
    local: gui_config.LocalConfig | None = None,
    ssh: gui_config.SshConfig | None = None,
) -> gui_config.Config:
    return gui_config.Config(
        connection=connection,
        local=local or gui_config.LocalConfig("/opt/local", "/local/data", "gx"),
        ssh=ssh or gui_config.SshConfig("nas", "/srv/ssh", "/srv/ssh-data", "gx"),
    )


def make_state(
    *,
    target: Target | None = None,
    host: HostConfig | None = ...,
    identity_value: parsing.Identity | None = None,
) -> AppState:
    target = target or local_target()
    if host is ...:
        host = host_for(target)
    hosts = {target.key: host} if host is not None else {}
    return AppState(
        target=target,
        hosts=hosts,
        identity=identity_value,
    )


class FakeController:
    """设置页测试替身；配置与状态都可替换以模拟切目标。"""

    def __init__(
        self,
        state: AppState,
        config: gui_config.Config | None = None,
    ) -> None:
        self._state = state
        self.config = config or make_config()
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

    def test_connection(self, endpoint: Endpoint) -> None:
        self._record("test_connection", endpoint)

    def apply_target(self, endpoint: Endpoint) -> None:
        self._record("apply_target", endpoint)

    def save_server_config(self, values: dict[str, str]) -> None:
        self._record("save_server_config", values)

    def logout(self) -> None:
        self._record("logout")

    def show_help(self) -> None:
        self._record("show_help")


class SettingsPageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        self._dark_hint = theme._dark_hint
        theme._dark_hint = False
        self.host = QWidget()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def tearDown(self) -> None:
        theme._dark_hint = self._dark_hint
        self.host.close()
        self.host.deleteLater()
        self.app.processEvents()

    def _page(
        self,
        state: AppState,
        config: gui_config.Config | None = None,
    ) -> tuple[SettingsPage, FakeController]:
        controller = FakeController(state, config)
        page = SettingsPage(controller)
        page.widget.setParent(self.host)
        return page, controller

    def _render(self, page: SettingsPage, state: AppState) -> None:
        page.render(derive_ui(state, NOW), state)

    def _write_binary(self, directory: str | None = None) -> str:
        root = Path(directory or self.temp.name)
        binary = root / "chat-deepseek"
        binary.write_text("", encoding="utf-8")
        return str(binary)

    # -- 外壳 / 初值 -------------------------------------------------------

    def test_page_uses_scroll_area_instead_of_fixed_height(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self.assertIsInstance(page.scroll, QScrollArea)
        self.assertTrue(page.scroll.widgetResizable())
        self.assertGreaterEqual(page.widget.minimumHeight(), 0)
        self.assertNotEqual(page.widget.minimumHeight(), page.widget.maximumHeight())

    def test_initial_values_come_from_both_config_sections(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertEqual(page.local_binary.text(), "/opt/local")
        self.assertEqual(page.local_data.text(), "/local/data")
        self.assertEqual(page.ssh_host.text(), "nas")
        self.assertEqual(page.ssh_binary.text(), "/srv/ssh")
        self.assertEqual(page.ssh_data.text(), "/srv/ssh-data")
        self.assertFalse(page.is_dirty())

    def test_local_mode_shows_local_rows_and_hides_ssh_rows(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertFalse(page.connection_grid.row("local_binary").isHidden())
        self.assertFalse(page.connection_grid.row("local_data").isHidden())
        self.assertTrue(page.connection_grid.row("ssh_host").isHidden())
        self.assertTrue(page.connection_grid.row("ssh_binary").isHidden())

    def test_switching_mode_only_shows_matching_rows(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)

        page.mode.setValue("ssh")
        self.assertTrue(page.connection_grid.row("local_binary").isHidden())
        self.assertTrue(page.connection_grid.row("local_data").isHidden())
        self.assertFalse(page.connection_grid.row("ssh_host").isHidden())
        self.assertFalse(page.connection_grid.row("ssh_binary").isHidden())
        self.assertFalse(page.connection_grid.row("ssh_data").isHidden())

    # -- 校验 / 测试连接 ---------------------------------------------------

    def test_test_connection_passes_local_endpoint(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        self._write_binary()
        page.local_binary.setText(self.temp.name)
        page.local_data.setText("/data")

        page.test_button.click()
        self.assertEqual(controller.names(), ["test_connection"])
        endpoint = controller.calls[0][1][0]
        self.assertEqual(endpoint.kind, ConnectionKind.LOCAL)
        self.assertEqual(endpoint.binary_dir, self.temp.name)
        self.assertEqual(endpoint.data_dir, "/data")

    def test_local_binary_may_be_a_file(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        binary = self._write_binary()
        page.local_binary.setText(binary)
        page.local_data.setText("/data")

        page.test_button.click()
        self.assertEqual(controller.names(), ["test_connection"])
        self.assertEqual(controller.calls[0][1][0].binary_dir, binary)
        self.assertTrue(page.connection_error.isHidden())

    def test_test_connection_passes_ssh_endpoint(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        page.mode.setValue("ssh")
        page.ssh_host.setText("nas")
        page.ssh_binary.setText("/srv/app")
        page.ssh_data.setText("/srv/app-data")

        page.test_button.click()
        endpoint = controller.calls[0][1][0]
        self.assertEqual(endpoint.kind, ConnectionKind.SSH)
        self.assertEqual(endpoint.host, "nas")
        self.assertEqual(endpoint.binary_dir, "/srv/app")
        self.assertEqual(endpoint.data_dir, "/srv/app-data")

    def test_validation_error_is_inline_and_skips_controller(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        page.local_binary.setText("/definitely/not/here")
        page.local_data.setText("/data")

        page.test_button.click()
        self.assertEqual(controller.calls, [])
        self.assertFalse(page.connection_error.isHidden())
        self.assertIn("目录里没有 chat-deepseek", page.connection_error.text())

    def test_apply_target_passes_endpoint(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        self._write_binary()
        page.local_binary.setText(self.temp.name)
        page.local_data.setText("/data")

        page.apply_button.click()
        self.assertEqual(controller.names(), ["apply_target"])
        self.assertEqual(controller.calls[0][1][0].binary_dir, self.temp.name)

    # -- 草稿保护 ----------------------------------------------------------

    def test_can_leave_true_without_changes(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)
        with mock.patch.object(settings_module, "ask_confirm") as confirm:
            self.assertTrue(page.can_leave())
        confirm.assert_not_called()

    def test_can_leave_true_before_first_render(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        with mock.patch.object(settings_module, "ask_confirm") as confirm:
            self.assertTrue(page.can_leave())
        confirm.assert_not_called()

    def test_can_leave_asks_before_discarding_changes(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)
        page.local_binary.setText("/changed")

        with mock.patch.object(
            settings_module, "ask_confirm", return_value=False
        ) as confirm:
            self.assertFalse(page.can_leave())
        confirm.assert_called_once()
        self.assertEqual(confirm.call_args.args[1], "放弃修改")
        self.assertIn("离开会丢失修改", confirm.call_args.args[2])
        self.assertFalse(confirm.call_args.kwargs["danger"])

        with mock.patch.object(
            settings_module, "ask_confirm", return_value=True
        ):
            self.assertTrue(page.can_leave())

    def test_target_key_change_resets_draft_from_new_config(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        page.local_binary.setText("/changed")

        new_target = local_target("/new/data")
        new_config = make_config(
            local=gui_config.LocalConfig("/new/bin", "/new/data", "gx")
        )
        new_state = make_state(
            target=new_target, host=host_for(new_target), identity_value=identity()
        )
        controller.config = new_config
        controller.set_state(new_state)
        self._render(page, new_state)

        self.assertEqual(page.local_binary.text(), "/new/bin")
        self.assertEqual(page.local_data.text(), "/new/data")
        self.assertFalse(page.is_dirty())

    # -- 服务端配置 --------------------------------------------------------

    def test_server_card_badge_says_which_host(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)
        self.assertEqual(page.server_badge.text(), "来自本机的 config.json")

        target = remote_target()
        remote_state = make_state(
            target=target, host=host_for(target), identity_value=identity()
        )
        remote_page, _controller = self._page(remote_state)
        self._render(remote_page, remote_state)
        self.assertIn("nas", remote_page.server_badge.text())

    def test_save_server_config_sends_exactly_four_values(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        page.server_listen.setText("0.0.0.0:9000")
        page.server_public_url.setText("https://chat.example.com")
        page.server_api_origin.setText("https://api.example.com")
        page.server_backup.setText("/backup")

        page.save_server_button.click()
        self.assertEqual(controller.names(), ["save_server_config"])
        values = controller.calls[0][1][0]
        self.assertEqual(
            set(values),
            {"backup_dir", "listen", "public_url", "api_origin"},
        )
        self.assertEqual(values["listen"], "0.0.0.0:9000")
        self.assertEqual(values["backup_dir"], "/backup")

    def test_server_fields_disabled_while_info_is_missing(self) -> None:
        state = make_state(host=None, identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertFalse(page.server_listen.isEnabled())
        self.assertFalse(page.server_backup.field.isEnabled())
        self.assertFalse(page.server_backup.isEnabled())
        self.assertEqual(
            page.server_listen.edit.placeholderText(), "正在读取…"
        )
        self.assertFalse(page.save_server_button.isEnabled())

    def test_server_error_is_inline_and_skips_controller(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)
        page.server_listen.setText("")
        page.save_server_button.click()

        self.assertEqual(controller.calls, [])
        self.assertFalse(page.server_error.isHidden())
        self.assertIn("监听地址不能为空", page.server_error.text())

    def test_rerender_does_not_overwrite_server_edits(self) -> None:
        state = make_state(identity_value=identity())
        page, _controller = self._page(state)
        self._render(page, state)
        page.server_listen.setText("0.0.0.0:9000")
        self._render(page, state)
        self.assertEqual(page.server_listen.text(), "0.0.0.0:9000")

    # -- 登录 / 关于 -------------------------------------------------------

    def test_login_card_shows_identity_and_logout_calls_controller(self) -> None:
        state = make_state(identity_value=identity(groups=("Owner", "Admin")))
        page, controller = self._page(state)
        self._render(page, state)

        self.assertIn("gx（Owner）", page.identity_field.text())
        self.assertEqual(page.groups_field.text(), "Owner, Admin")
        self.assertTrue(page.expires_field.text().startswith("2026-11-26 12:12:00"))
        self.assertFalse(page.logout_button.isHidden())
        page.logout_button.click()
        self.assertEqual(controller.names(), ["logout"])

    def test_logged_out_login_card_shows_placeholder(self) -> None:
        state = make_state(identity_value=None)
        page, _controller = self._page(state)
        self._render(page, state)

        self.assertEqual(page.identity_field.text(), "未登录")
        self.assertEqual(page.groups_field.text(), "—")
        self.assertTrue(page.logout_button.isHidden())

    def test_about_card_shows_version_and_help(self) -> None:
        state = make_state(identity_value=identity())
        page, controller = self._page(state)
        self._render(page, state)

        self.assertEqual(page.version_label.text(), "0.1.4 · linux/amd64")
        page.help_button.click()
        self.assertEqual(controller.names(), ["show_help"])


if __name__ == "__main__":
    unittest.main()
