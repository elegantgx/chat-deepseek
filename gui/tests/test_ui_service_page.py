"""C5c 服务页测试：状态卡、详情卡、日志、安装/卸载与自动打开。"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QApplication

import service_plan
import theme
from cdgui.domain.facts import (
    ForegroundPhase,
    ForegroundSession,
    HostConfig,
    ServiceStatus,
)
from cdgui.domain.rules import ActionId
from cdgui.domain.state import AppState
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.ui.pages import service as service_page
from cdgui.ui.pages.service import ServicePage
from cdgui.ui.render import derive_ui

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


def remote_target(
    host: str = "nas", data_dir: str = "/srv/chat-deepseek/data"
) -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.SSH,
            host=host,
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
    supported: bool = True,
    installed: bool = False,
    active: bool = False,
    enabled: bool = False,
    linger: bool = False,
    unit: str = "",
    listen: str = "127.0.0.1:8090",
    public_url: str = "",
    data_dir: str | None = None,
) -> HostConfig:
    if active:
        installed = True
    return HostConfig(
        target_key=target.key,
        version="0.1.4",
        os="linux",
        arch="amd64",
        initialized=initialized,
        listen=listen,
        public_url=public_url,
        api_origin="",
        backup_dir="",
        service=ServiceStatus(
            supported=supported,
            installed=installed,
            active=active,
            enabled=enabled,
            linger=linger,
            unit=unit,
        ),
        data_dir=target.data_dir if data_dir is None else data_dir,
    )


def foreground(
    target: Target,
    *,
    url: str = "http://127.0.0.1:8090",
    phase: ForegroundPhase = ForegroundPhase.RUNNING,
    tail: tuple[str, ...] = ("监听 127.0.0.1:8090",),
) -> ForegroundSession:
    return ForegroundSession(
        target_key=target.key,
        phase=phase,
        address="127.0.0.1:8090",
        url=url,
        tail=tail,
    )


def state_for(
    target: Target,
    host: HostConfig | None,
    *,
    fg: ForegroundSession | None = None,
    info_error: str | None = None,
) -> AppState:
    hosts = {target.key: host} if host is not None else {}
    return AppState(
        target=target,
        hosts=hosts,
        foreground=fg,
        info_error=info_error,
    )


class FakeController:
    """只实现服务页用到的方法，并记录每次调用。"""

    def __init__(self, state: AppState, service_user: str = "gx") -> None:
        self._state = state
        self._service_user = service_user
        self.calls: list[tuple[str, tuple, dict]] = []

    @property
    def state(self) -> AppState:
        return self._state

    @property
    def service_user(self) -> str:
        return self._service_user

    def set_state(self, state: AppState) -> None:
        self._state = state

    def _record(self, name: str, *args, **kwargs) -> None:
        self.calls.append((name, args, kwargs))

    def names(self) -> list[str]:
        return [call[0] for call in self.calls]

    def set_page(self, page) -> None:
        self._record("set_page", page)

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

    def show_help(self) -> None:
        self._record("show_help")


class FakeDesktop:
    """替身：QDesktopServices.openUrl 在 offscreen 平台不可用。"""

    urls: list[str] = []

    @classmethod
    def openUrl(cls, url) -> None:  # noqa: N802 - Qt 命名
        cls.urls.append(url.toString())

    @classmethod
    def reset(cls) -> None:
        cls.urls = []


class FakeSheet:
    """记录构造参数；exec_modal 返回预置 dict。"""

    instances: list["FakeSheet"] = []
    value: dict | None = None

    def __init__(self, parent, **kwargs) -> None:
        self.parent = parent
        self.kwargs = kwargs
        FakeSheet.instances.append(self)

    def exec_modal(self):
        return FakeSheet.value


def make_page(
    state: AppState,
    *,
    service_user: str = "gx",
    show: bool = True,
    auto_open: bool = False,
) -> tuple[ServicePage, FakeController]:
    controller = FakeController(state, service_user=service_user)
    page = ServicePage(controller)
    page.widget.resize(900, 700)
    if show:
        page.widget.show()
    page.auto_open.setChecked(auto_open)
    page.render(derive_ui(state, NOW), state)
    QApplication.processEvents()
    return page, controller


def rerender(page: ServicePage, controller: FakeController, state: AppState) -> None:
    controller.set_state(state)
    page.render(derive_ui(state, NOW), state)
    QApplication.processEvents()


class ServicePageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        self._dark_hint = theme._dark_hint
        theme._dark_hint = False
        self.pages: list[ServicePage] = []

    def tearDown(self) -> None:
        theme._dark_hint = self._dark_hint
        for page in self.pages:
            page.widget.hide()
            page.widget.deleteLater()
        self.app.processEvents()

    def build_page(self, state: AppState, **kwargs):
        page, controller = make_page(state, **kwargs)
        self.pages.append(page)
        return page, controller

    # -- 状态矩阵 ----------------------------------------------------------

    def test_systemd_active_offers_stop_restart_and_open(self) -> None:
        target = local_target()
        host = host_for(
            target,
            installed=True,
            active=True,
            enabled=True,
            unit="/home/gx/.config/systemd/user/chat-deepseek.service",
        )
        page, _ = self.build_page(state_for(target, host))

        self.assertEqual(page.primary_button.text(), "停止")
        self.assertTrue(page.primary_button.isEnabled())
        self.assertTrue(page.restart_button.isVisible())
        self.assertTrue(page.restart_button.isEnabled())
        self.assertTrue(page.open_button.isEnabled())
        self.assertEqual(page.status_badge.text(), "运行中")
        self.assertEqual(page.status_badge.tone(), "success")

    def test_systemd_stopped_offers_start_but_not_restart(self) -> None:
        target = local_target()
        host = host_for(target, installed=True)
        page, _ = self.build_page(state_for(target, host))

        self.assertEqual(page.primary_button.text(), "启动")
        self.assertTrue(page.primary_button.isEnabled())
        self.assertFalse(page.restart_button.isEnabled())
        self.assertEqual(page.restart_button.toolTip(), "服务没有在运行，先用“启动服务”")
        self.assertFalse(page.open_button.isEnabled())
        self.assertEqual(page.update_action.isVisible(), True)
        self.assertEqual(page.uninstall_action.isVisible(), True)

    def test_foreground_running_shows_log_and_stop(self) -> None:
        target = local_target()
        host = host_for(target)
        fg = foreground(target)
        page, _ = self.build_page(state_for(target, host, fg=fg))

        self.assertEqual(page.primary_button.text(), "停止")
        self.assertTrue(page.log_card.isVisible())
        self.assertIn("监听", page.detail_label.full_text())
        self.assertEqual(page.log_view.toPlainText(), "\n".join(fg.tail))

    def test_foreground_log_keeps_last_forty_lines(self) -> None:
        target = local_target()
        host = host_for(target)
        lines = tuple(f"line-{index}" for index in range(40))
        page, _ = self.build_page(
            state_for(target, host, fg=foreground(target, tail=lines)),
        )

        text_lines = page.log_view.toPlainText().splitlines()
        self.assertEqual(len(text_lines), 40)
        self.assertEqual(text_lines[0], "line-0")
        self.assertEqual(text_lines[-1], "line-39")
        self.assertEqual(page.log_view.maximumBlockCount(), 40)

    def test_uninstalled_systemd_shows_cta_and_install_menu(self) -> None:
        target = local_target()
        host = host_for(target)
        page, _ = self.build_page(state_for(target, host))

        self.assertEqual(page.primary_button.text(), "启动")
        self.assertTrue(page.systemd_link.isVisible())
        self.assertTrue(page.systemd_link.isEnabled())
        self.assertEqual(page.systemd_link.text(), "改为 systemd 常驻…")
        self.assertTrue(page.install_action.isVisible())
        self.assertFalse(page.update_action.isVisible())
        self.assertFalse(page.uninstall_action.isVisible())
        self.assertTrue(page.help_action.isVisible())

    def test_uninitialized_shows_banner_and_create_owner(self) -> None:
        target = local_target()
        host = host_for(target, initialized=False)
        page, controller = self.build_page(state_for(target, host))

        self.assertTrue(page.banner.isVisible())
        self.assertIn("数据目录未初始化", page.banner_label.text())
        self.assertEqual(page.primary_button.text(), "创建 Owner")
        self.assertTrue(page.primary_button.isEnabled())
        self.assertFalse(page.install_action.isEnabled())

        page.primary_button.click()
        self.assertEqual(controller.names(), ["set_page"])
        self.assertEqual(controller.calls[0][1][0].value, "accounts")

    def test_info_error_shows_banner_but_keeps_verdicts(self) -> None:
        target = local_target()
        host = host_for(target, installed=True, active=True)
        state = state_for(target, host, info_error="ssh: connect timed out")
        page, _ = self.build_page(state)
        ui = derive_ui(state, NOW)

        self.assertTrue(page.banner.isVisible())
        self.assertIn("状态读取失败", page.banner_label.text())
        # 读不到 info 不等于旧配置不能操作：按钮仍只看 Verdict。
        self.assertTrue(page.primary_button.isEnabled())
        self.assertEqual(
            page.primary_button.isEnabled(),
            ui.buttons[ActionId.STOP].enabled,
        )
        self.assertEqual(
            page.primary_button.toolTip(),
            ui.buttons[ActionId.STOP].tooltip,
        )
        self.assertEqual(
            page.restart_button.isEnabled(),
            ui.buttons[ActionId.RESTART].enabled,
        )
        self.assertEqual(
            page.open_button.isEnabled(),
            ui.buttons[ActionId.OPEN_PAGE].enabled,
        )
        self.assertTrue(page.update_action.isEnabled())
        retry = [
            button
            for button in page.widget.findChildren(service_page.primitives.Button)
            if "重试" in button.text()
        ]
        self.assertEqual(retry, [])

    def test_info_pending_hides_detail_and_log(self) -> None:
        target = local_target()
        page, _ = self.build_page(state_for(target, None))

        self.assertFalse(page.detail_card.isVisible())
        self.assertFalse(page.log_card.isVisible())
        self.assertFalse(page.banner.isVisible())
        self.assertEqual(page.status_badge.text(), "尚未启动")
        self.assertEqual(page.detail_label.full_text(), "正在读取服务状态…")

    # -- 打开页面 ----------------------------------------------------------

    def test_open_page_uses_ui_url(self) -> None:
        target = local_target()
        host = host_for(target)
        fg = foreground(target, url="http://127.0.0.1:8090/")
        page, _ = self.build_page(state_for(target, host, fg=fg))
        FakeDesktop.reset()

        with mock.patch.object(service_page, "QDesktopServices", FakeDesktop):
            page.open_button.click()

        self.assertEqual(FakeDesktop.urls, ["http://127.0.0.1:8090"])

    def test_open_page_without_url_does_nothing(self) -> None:
        target = remote_target()
        host = host_for(target, public_url="")
        page, _ = self.build_page(state_for(target, host))
        FakeDesktop.reset()

        self.assertFalse(page.open_button.isVisible())
        with mock.patch.object(service_page, "QDesktopServices", FakeDesktop):
            page._open_page()

        self.assertEqual(FakeDesktop.urls, [])

    def test_auto_open_once_per_url_and_reset_on_stop(self) -> None:
        target = local_target()
        host = host_for(target)
        first = foreground(target, url="http://127.0.0.1:8090")
        page, controller = self.build_page(
            state_for(target, host, fg=first), auto_open=True
        )
        page._auto_opened_url = None
        FakeDesktop.reset()

        with mock.patch.object(service_page, "QDesktopServices", FakeDesktop):
            rerender(page, controller, state_for(target, host, fg=first))
            self.assertEqual(FakeDesktop.urls, ["http://127.0.0.1:8090"])

            rerender(page, controller, state_for(target, host, fg=first))
            self.assertEqual(len(FakeDesktop.urls), 1)

            second = foreground(target, url="http://127.0.0.1:8091")
            rerender(page, controller, state_for(target, host, fg=second))
            self.assertEqual(len(FakeDesktop.urls), 2)

            rerender(page, controller, state_for(target, host))
            rerender(page, controller, state_for(target, host, fg=first))
            self.assertEqual(FakeDesktop.urls[-1], "http://127.0.0.1:8090")
            self.assertEqual(len(FakeDesktop.urls), 3)

    def test_auto_open_skips_when_switch_is_off(self) -> None:
        target = local_target()
        host = host_for(target)
        fg = foreground(target)
        page, controller = self.build_page(state_for(target, host, fg=fg))
        page._auto_opened_url = None
        FakeDesktop.reset()

        with mock.patch.object(service_page, "QDesktopServices", FakeDesktop):
            rerender(page, controller, state_for(target, host, fg=fg))
            self.assertEqual(FakeDesktop.urls, [])
            page.auto_open.setChecked(True)
            rerender(page, controller, state_for(target, host, fg=fg))
            self.assertEqual(len(FakeDesktop.urls), 1)

    # -- 安装 / 更新 / 卸载 ------------------------------------------------

    def test_install_sheet_options_then_install_service(self) -> None:
        target = local_target()
        host = host_for(target, linger=False, unit="")
        page, controller = self.build_page(state_for(target, host))
        FakeSheet.instances = []
        FakeSheet.value = {
            "scope": "user",
            "enable": True,
            "start": True,
            "force": False,
        }

        with mock.patch.object(service_page, "ServiceInstallSheet", FakeSheet):
            page.install_action.trigger()

        sheet = FakeSheet.instances[0]
        self.assertEqual(sheet.kwargs["binary"], target.binary)
        self.assertEqual(sheet.kwargs["data_dir"], host.data_dir)
        self.assertFalse(sheet.kwargs["linger"])
        self.assertEqual(sheet.kwargs["username"], "gx")
        self.assertEqual(sheet.kwargs["host"], "")
        self.assertFalse(sheet.kwargs["installed"])
        self.assertEqual(controller.names(), ["install_service"])
        self.assertEqual(controller.calls[0][1][0], FakeSheet.value)

    def test_update_sheet_options_then_update_service(self) -> None:
        target = local_target()
        host = host_for(
            target, installed=True, active=True, enabled=True, linger=True
        )
        page, controller = self.build_page(state_for(target, host))
        FakeSheet.instances = []
        FakeSheet.value = {
            "scope": "user",
            "enable": True,
            "start": False,
            "force": True,
        }

        with mock.patch.object(service_page, "ServiceInstallSheet", FakeSheet):
            page.update_action.trigger()

        sheet = FakeSheet.instances[0]
        self.assertTrue(sheet.kwargs["installed"])
        self.assertTrue(sheet.kwargs["enabled"])
        self.assertTrue(sheet.kwargs["active"])
        self.assertTrue(sheet.kwargs["linger"])
        self.assertEqual(controller.names(), ["update_service"])

    def test_systemd_cta_opens_install_sheet(self) -> None:
        target = local_target()
        host = host_for(target)
        page, controller = self.build_page(state_for(target, host))
        FakeSheet.instances = []
        FakeSheet.value = None

        with mock.patch.object(service_page, "ServiceInstallSheet", FakeSheet):
            page.systemd_link.click()

        self.assertEqual(len(FakeSheet.instances), 1)
        self.assertEqual(controller.names(), [])

    def test_uninstall_requires_danger_confirmation(self) -> None:
        target = local_target()
        host = host_for(target, installed=True)
        page, controller = self.build_page(state_for(target, host))

        with mock.patch.object(
            service_page, "ask_confirm", return_value=False
        ) as confirm:
            page.uninstall_action.trigger()
        self.assertEqual(controller.names(), [])
        confirm.assert_called_once()
        self.assertTrue(confirm.call_args.kwargs["danger"])

        with mock.patch.object(service_page, "ask_confirm", return_value=True):
            page.uninstall_action.trigger()
        self.assertEqual(controller.names(), ["uninstall_service"])

    # -- 详情 / 复制 -------------------------------------------------------

    def test_log_copy_button_uses_clipboard(self) -> None:
        target = local_target()
        host = host_for(target)
        sandbox_clipboard = QGuiApplication.clipboard()
        sandbox_clipboard.clear()
        page, _ = self.build_page(
            state_for(target, host, fg=foreground(target, tail=("hello", "world")))
        )

        page.log_copy.click()
        self.assertEqual(sandbox_clipboard.text(), "hello\nworld")

    def test_linger_command_uses_planned_command(self) -> None:
        target = local_target()
        host = host_for(target, linger=False)
        page, _ = self.build_page(state_for(target, host))
        self.assertEqual(
            page.linger_row.text(),
            service_plan.linger_command("gx", enable=True, host=""),
        )

        page, _ = self.build_page(
            state_for(target, host_for(target, linger=True))
        )
        self.assertEqual(
            page.linger_row.text(),
            service_plan.linger_command("gx", enable=False, host=""),
        )

    def test_linger_command_remote_uses_host_and_placeholder_user(self) -> None:
        target = remote_target()
        host = host_for(target, listen="127.0.0.1:8090")
        page, _ = self.build_page(
            state_for(target, host), service_user=""
        )

        self.assertEqual(
            page.linger_row.text(),
            service_plan.linger_command("<user>", enable=True, host="nas"),
        )
        self.assertIn("ssh -t nas", page.linger_row.text())

    def test_data_dir_fallback_and_empty_unit_placeholder(self) -> None:
        target = local_target("/srv/chat-deepseek/data")
        host = host_for(target, data_dir="", unit="")
        page, _ = self.build_page(state_for(target, host))

        self.assertEqual(page.data_dir_row.text(), target.data_dir)
        self.assertEqual(page.unit_row.text(), "—")

    def test_autostart_and_linger_badges(self) -> None:
        target = local_target()
        host = host_for(target, installed=True, enabled=True, linger=False)
        page, _ = self.build_page(state_for(target, host))

        self.assertEqual(page.autostart_badge.text(), "开机自启")
        self.assertEqual(page.autostart_badge.tone(), "success")
        self.assertEqual(page.linger_badge.text(), "linger 未开启")
        self.assertEqual(page.linger_badge.tone(), "warning")

    def test_status_badge_matches_ui_projection(self) -> None:
        target = local_target()
        host = host_for(target, installed=True)
        state = state_for(target, host)
        page, _ = self.build_page(state)
        ui = derive_ui(state, NOW)

        self.assertEqual(page.status_badge.text(), ui.service_pill[0])
        self.assertEqual(page.status_badge.tone(), ui.service_pill[1])
        self.assertEqual(page.detail_label.full_text(), ui.service_detail)

    # -- 主按钮 ------------------------------------------------------------

    def test_primary_button_starts_and_stops_by_running_state(self) -> None:
        target = local_target()
        host = host_for(target, installed=True)
        page, controller = self.build_page(state_for(target, host))
        page.primary_button.click()
        self.assertEqual(controller.names(), ["start_service"])

        running = state_for(target, host_for(target, installed=True, active=True))
        rerender(page, controller, running)
        page.primary_button.click()
        self.assertEqual(controller.names(), ["start_service", "stop_service"])


if __name__ == "__main__":
    unittest.main()
