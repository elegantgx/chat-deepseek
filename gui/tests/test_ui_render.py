"""C5b 渲染投影测试：derive_ui 与 apply（offscreen）。"""

from __future__ import annotations

import os
import sys
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtWidgets import QApplication, QWidget

import parsing
import theme
from cdgui.domain.facts import (
    ForegroundPhase,
    ForegroundSession,
    HostConfig,
    ServiceStatus,
)
from cdgui.domain.rules import ActionId, ActionReason, Verdict
from cdgui.domain.state import (
    AppState,
    InflightEntry,
    PageId,
    TaskKey,
)
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.ui import render
from cdgui.ui.pages.base import Page
from cdgui.ui.primitives import Button
from cdgui.ui.views import Views

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
    public_url: str = "",
    version: str = "0.1.4",
    os_name: str = "linux",
    arch: str = "amd64",
    data_dir: str | None = None,
) -> HostConfig:
    if active:
        installed = True
    return HostConfig(
        target_key=target.key,
        version=version,
        os=os_name,
        arch=arch,
        initialized=initialized,
        listen="127.0.0.1:8090",
        public_url=public_url,
        api_origin="",
        backup_dir="",
        service=ServiceStatus(
            supported=supported,
            installed=installed,
            active=active,
            enabled=enabled,
            linger=linger,
        ),
        data_dir=data_dir or target.data_dir or "/srv/chat-deepseek/data",
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


def user(username: str, groups: tuple[str, ...] = ("User",)) -> parsing.User:
    return parsing.User(
        username=username, groups=groups, disabled=False, id=username
    )


def backup(name: str, size: str, moment: datetime) -> parsing.Backup:
    return parsing.Backup(name=name, size=size, time=moment)


def base_state(target: Target | None = None, **overrides) -> AppState:
    goal = target or local_target()
    state = AppState(target=goal)
    if overrides:
        state = replace(state, **overrides)
    return state


class DeriveUiTest(unittest.TestCase):
    def test_unauthenticated_projection(self) -> None:
        target = local_target()
        state = base_state(
            target, hosts={target.key: host_for(target)}
        )
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.identity_text, "未登录")
        self.assertEqual(ui.login_button_text, "登录")
        self.assertEqual(ui.identity_tooltip, "登录后才能管理账户和备份")
        self.assertEqual(ui.nav_badges[PageId.ACCOUNTS], "—")
        self.assertEqual(ui.nav_badges[PageId.BACKUPS], "—")
        self.assertFalse(ui.busy)
        self.assertEqual(ui.version_label, "0.1.4 · linux/amd64")
        self.assertEqual(ui.backup_line, "登录后查看备份记录")
        self.assertEqual(ui.target_label, "本机 · data")
        self.assertEqual(ui.service_pill, ("未运行", "muted"))
        self.assertIsNone(ui.notice)

    def test_buttons_are_rules_verdicts(self) -> None:
        target = local_target()
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            identity=identity(groups=("Owner",)),
            users=(user("gx", ("Owner",)), user("alice")),
            selected="alice",
        )
        ui = render.derive_ui(state, NOW)

        self.assertEqual(set(ui.buttons), set(ActionId))
        for action in ActionId:
            self.assertEqual(
                ui.buttons[action],
                render.rules.action_verdict(state, action, NOW),
                action,
            )
        self.assertTrue(ui.buttons[ActionId.RESET_PASSWORD].enabled)
        self.assertTrue(ui.buttons[ActionId.BACKUP_NOW].enabled)

    def test_admin_identity_badges_and_forbidden_backup(self) -> None:
        target = local_target()
        older = backup("backup-old.zip", "1.0MB", NOW - timedelta(days=1))
        newer = backup("backup-new.zip", "2.1MB", NOW - timedelta(hours=3))
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            identity=identity(username="ada", groups=("Admin",), minutes=12),
            users=(user("ada", ("Admin",)), user("bob")),
            backups=(older, newer),
        )
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.identity_text, "ada（Admin） · 12 分钟后过期")
        self.assertEqual(ui.login_button_text, "退出")
        self.assertIn("账户：ada", ui.identity_tooltip)
        self.assertIn("组：Admin", ui.identity_tooltip)
        self.assertIn("过期：2026-11-26 12:12:00", ui.identity_tooltip)
        self.assertEqual(ui.nav_badges[PageId.ACCOUNTS], "2")
        self.assertEqual(ui.nav_badges[PageId.BACKUPS], "2")
        self.assertEqual(ui.backup_line, "需要 Owner 登录才能查看备份")
        verdict = ui.buttons[ActionId.BACKUP_NOW]
        self.assertFalse(verdict.enabled)
        self.assertEqual(verdict.reason, ActionReason.FORBIDDEN)
        self.assertEqual(ui.buttons[ActionId.GRANT].reason, ActionReason.FORBIDDEN)

    def test_owner_backup_line_uses_latest(self) -> None:
        target = local_target()
        older = backup("backup-old.zip", "1.0MB", NOW - timedelta(days=1))
        newer = backup("backup-new.zip", "2.1MB", NOW - timedelta(hours=3))
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            identity=identity(),
            backups=(older, newer),
        )
        ui = render.derive_ui(state, NOW)
        self.assertEqual(
            ui.backup_line, "最近备份：2026-11-26 09:00:00（2.1MB）"
        )

    def test_owner_selected_actions_and_empty_backups(self) -> None:
        target = local_target()
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            identity=identity(),
            users=(user("gx", ("Owner",)), user("alice")),
            selected="alice",
            backups=(),
        )
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.backup_line, "还没有备份记录")
        self.assertEqual(ui.nav_badges[PageId.ACCOUNTS], "2")
        self.assertEqual(ui.nav_badges[PageId.BACKUPS], "0")
        for action in (
            ActionId.RESET_PASSWORD,
            ActionId.TOGGLE_USER,
            ActionId.GRANT,
            ActionId.DELETE_USER,
            ActionId.BACKUP_NOW,
        ):
            self.assertTrue(ui.buttons[action].enabled, action)
        self.assertEqual(ui.buttons[ActionId.TOGGLE_USER].text, "禁用")

    def test_is_owner_true_for_owner(self) -> None:
        target = local_target()
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            identity=identity(groups=("Owner",)),
        )
        ui = render.derive_ui(state, NOW)
        self.assertTrue(ui.is_owner)

    def test_is_owner_false_for_admin_and_anonymous(self) -> None:
        target = local_target()
        admin = base_state(
            target,
            hosts={target.key: host_for(target)},
            identity=identity(groups=("Admin",)),
        )
        self.assertFalse(render.derive_ui(admin, NOW).is_owner)

        anonymous = base_state(
            target, hosts={target.key: host_for(target)}
        )
        self.assertFalse(render.derive_ui(anonymous, NOW).is_owner)

    def test_remote_target_version_and_page_url(self) -> None:
        target = remote_target()
        state = base_state(
            target,
            hosts={
                target.key: host_for(
                    target,
                    installed=True,
                    active=True,
                    public_url="https://nas.example/",
                )
            },
        )
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.target_label, "SSH nas · data")
        self.assertIn("数据目录：/srv/chat-deepseek/data", ui.target_tooltip)
        self.assertEqual(
            ui.version_label, "0.1.4 · linux/amd64 · SSH nas"
        )
        self.assertEqual(ui.page_url, "https://nas.example")
        self.assertFalse(ui.buttons[ActionId.BACKUP_AS].visible)
        self.assertTrue(ui.buttons[ActionId.OPEN_PAGE].enabled)

    def test_local_foreground_running_projection(self) -> None:
        target = local_target()
        foreground = ForegroundSession(
            target_key=target.key,
            phase=ForegroundPhase.RUNNING,
            address="127.0.0.1:8090",
            url="http://127.0.0.1:8090",
        )
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            foreground=foreground,
        )
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.service_pill, ("运行中", "success"))
        self.assertEqual(ui.service_detail, "监听 127.0.0.1:8090")
        self.assertEqual(ui.page_url, "http://127.0.0.1:8090")
        self.assertFalse(ui.buttons[ActionId.START].enabled)
        self.assertTrue(ui.buttons[ActionId.STOP].enabled)
        self.assertTrue(ui.buttons[ActionId.OPEN_PAGE].enabled)
        self.assertFalse(ui.buttons[ActionId.RESTART].visible)

    def test_remote_foreground_is_not_a_local_url(self) -> None:
        target = remote_target()
        foreground = ForegroundSession(
            target_key=target.key,
            phase=ForegroundPhase.RUNNING,
            address="127.0.0.1:8090",
            url="http://127.0.0.1:8090",
        )
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            foreground=foreground,
        )
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.service_pill, ("运行中", "success"))
        self.assertEqual(
            ui.service_detail, "远端监听 127.0.0.1:8090（本机不可直连）"
        )
        self.assertEqual(ui.page_url, "")

    def test_uninitialized_projection(self) -> None:
        target = local_target()
        state = base_state(
            target,
            hosts={target.key: host_for(target, initialized=False)},
        )
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.service_pill, ("未初始化", "warning"))
        self.assertEqual(ui.service_detail, "数据目录未初始化")
        login = ui.buttons[ActionId.LOGIN]
        self.assertFalse(login.enabled)
        self.assertEqual(login.tooltip, "先创建 Owner")
        self.assertTrue(ui.buttons[ActionId.SETUP_OWNER].enabled)
        self.assertEqual(ui.nav_badges[PageId.ACCOUNTS], "—")
        self.assertEqual(
            ui.buttons[ActionId.BACKUP_NOW].reason,
            ActionReason.NOT_INITIALIZED,
        )

    def test_info_error_without_facts(self) -> None:
        target = local_target()
        state = base_state(target, info_error="ssh: timeout")
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.service_pill, ("状态读取失败", "danger"))
        self.assertEqual(ui.service_detail, "状态读取失败 · 重试")
        self.assertEqual(ui.version_label, "chat-deepseek")

    def test_busy_gate_disables_every_action(self) -> None:
        target = local_target()
        inflight = {
            TaskKey.INFO: InflightEntry(TaskKey.INFO, target.key, 1)
        }
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            inflight=inflight,
        )
        ui = render.derive_ui(state, NOW)

        self.assertTrue(ui.busy)
        for action, verdict in ui.buttons.items():
            self.assertFalse(verdict.enabled, action)
            self.assertEqual(verdict.tooltip, "正在执行上一条命令", action)

    def test_target_label_and_tooltip_keep_full_path(self) -> None:
        target = local_target("/home/gx/very/long/data")
        state = base_state(target)
        ui = render.derive_ui(state, NOW)

        self.assertEqual(ui.target_label, "本机 · data")
        self.assertIn("/home/gx/very/long/data", ui.target_tooltip)
        self.assertIn("/opt/chat-deepseek/chat-deepseek", ui.target_tooltip)


class RecordingPage(Page):
    def __init__(self, page_id: PageId, title: str) -> None:
        super().__init__(None, page_id=page_id, title=title, description="占位")
        self.calls: list[tuple[object, object]] = []

    def render(self, ui, state) -> None:
        self.calls.append((ui, state))


class ApplyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        self._dark_hint = theme._dark_hint
        theme._dark_hint = False
        self.host = QWidget()
        self.pages = {
            PageId.SERVICE: RecordingPage(PageId.SERVICE, "服务"),
            PageId.ACCOUNTS: RecordingPage(PageId.ACCOUNTS, "账户"),
            PageId.BACKUPS: RecordingPage(PageId.BACKUPS, "备份"),
            PageId.SETTINGS: RecordingPage(PageId.SETTINGS, "设置"),
        }
        self.views = Views(self.pages, self.host)

    def tearDown(self) -> None:
        theme._dark_hint = self._dark_hint
        self.host.close()
        self.host.deleteLater()
        self.app.processEvents()

    def _ui(self, state: AppState):
        return render.derive_ui(state, NOW)

    def test_apply_sets_page_nav_and_identity(self) -> None:
        target = local_target()
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            identity=identity(),
        )
        render.apply(self._ui(state), self.views, state)

        self.assertIs(
            self.views.stacked.currentWidget(),
            self.pages[PageId.SERVICE].widget,
        )
        self.assertTrue(
            self.views.nav_buttons[PageId.SERVICE].is_selected()
        )
        self.assertFalse(
            self.views.nav_buttons[PageId.ACCOUNTS].is_selected()
        )
        self.assertEqual(
            self.views.identity_label.text(), "gx（Owner） · 12 分钟后过期"
        )
        self.assertEqual(self.views.login_button.text(), "退出")
        self.assertFalse(self.views.identity_avatar.isHidden())
        self.assertTrue(self.views.identity_lock.isHidden())
        self.assertEqual(
            self.views.nav_buttons[PageId.ACCOUNTS]._badge,
            "0",
        )

    def test_apply_delegates_only_current_page_with_state(self) -> None:
        target = local_target()
        state = base_state(target, hosts={target.key: host_for(target)})
        render.apply(self._ui(state), self.views, state)

        service = self.pages[PageId.SERVICE]
        self.assertEqual(len(service.calls), 1)
        self.assertIs(service.calls[0][1], state)
        self.assertEqual(self.pages[PageId.ACCOUNTS].calls, [])

        second = replace(state, page=PageId.BACKUPS)
        render.apply(self._ui(second), self.views, second)
        self.assertEqual(len(self.pages[PageId.BACKUPS].calls), 1)
        self.assertEqual(len(service.calls), 1)

    def test_apply_registered_button_visibility_text_and_busy(self) -> None:
        target = remote_target()
        remote = base_state(target, hosts={target.key: host_for(target)})
        button = Button("旧文案", kind="secondary")
        self.views.register_button(ActionId.BACKUP_AS, button)

        render.apply(self._ui(remote), self.views, remote)
        self.assertTrue(button.isHidden())
        self.assertEqual(button.text(), "备份到…")

        local = local_target()
        local_state = base_state(
            local, hosts={local.key: host_for(local)}
        )
        render.apply(self._ui(local_state), self.views, local_state)
        self.assertFalse(button.isHidden())
        self.assertTrue(button.isEnabled())

        inflight = {
            TaskKey.INFO: InflightEntry(TaskKey.INFO, local.key, 1)
        }
        busy = replace(local_state, inflight=inflight)
        render.apply(self._ui(busy), self.views, busy)
        self.assertFalse(button.isEnabled())
        self.assertEqual(button.toolTip(), "正在执行上一条命令")

    def test_apply_is_idempotent_and_compact_target(self) -> None:
        target = local_target()
        state = base_state(target, hosts={target.key: host_for(target)})
        ui = self._ui(state)
        render.apply(ui, self.views, state)
        first = self.views.target_chip.text()
        render.apply(ui, self.views, state)
        self.assertEqual(self.views.target_chip.text(), first)

        self.views.set_compact(True)
        render.apply(ui, self.views, state)
        self.assertEqual(self.views.target_chip.text(), "本机")
        self.assertTrue(self.views.brand_text.isHidden())

    def test_apply_busy_spinner_and_service_chip(self) -> None:
        target = local_target()
        inflight = {
            TaskKey.INFO: InflightEntry(TaskKey.INFO, target.key, 1)
        }
        state = base_state(
            target,
            hosts={target.key: host_for(target)},
            inflight=inflight,
        )
        render.apply(self._ui(state), self.views, state)

        self.assertTrue(self.views.busy_spinner.is_busy())
        self.assertFalse(self.views.busy_spinner.isHidden())
        self.assertEqual(self.views.service_chip.text(), "未运行")
        self.assertEqual(
            self.views.service_chip.toolTip(),
            "未安装 systemd 服务（前台运行）",
        )

    def test_apply_verdict_hides_and_shows(self) -> None:
        widget = Button("启动", kind="primary")
        render.apply_verdict(
            widget,
            Verdict(False, False, "启动", "不可用", ActionReason.BUSY),
        )
        self.assertTrue(widget.isHidden())
        self.assertFalse(widget.isEnabled())
        self.assertEqual(widget.toolTip(), "不可用")

        render.apply_verdict(
            widget, Verdict(True, True, "启动", "可用", ActionReason.OK)
        )
        self.assertFalse(widget.isHidden())
        self.assertTrue(widget.isEnabled())
        self.assertEqual(widget.toolTip(), "可用")

    def test_apply_verdict_writes_text_and_enabled(self) -> None:
        widget = Button("旧文案", kind="secondary")
        render.apply_verdict(
            widget,
            Verdict(False, True, "新文案", "稍后重试", ActionReason.BUSY),
        )
        self.assertEqual(widget.text(), "新文案")
        self.assertFalse(widget.isEnabled())
        self.assertEqual(widget.toolTip(), "稍后重试")

    def test_apply_verdict_empty_text_keeps_existing(self) -> None:
        widget = Button("保留文案", kind="ghost")
        render.apply_verdict(
            widget,
            Verdict(True, True, "", "无文案", ActionReason.OK),
        )
        self.assertEqual(widget.text(), "保留文案")
        self.assertEqual(widget.toolTip(), "无文案")

    def test_apply_clears_busy_spinner(self) -> None:
        target = local_target()
        state = base_state(target, hosts={target.key: host_for(target)})
        render.apply(self._ui(state), self.views, state)
        self.assertFalse(self.views.busy_spinner.is_busy())
        self.assertTrue(self.views.busy_spinner.isHidden())


if __name__ == "__main__":
    unittest.main()
