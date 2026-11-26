from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import parsing

from cdgui.domain import rules
from cdgui.domain.facts import (
    ForegroundPhase,
    ForegroundSession,
    HostConfig,
    ServiceStatus,
)
from cdgui.domain.rules import ActionId, ActionReason, action_verdict
from cdgui.domain.state import (
    AppState,
    InflightEntry,
    PageId,
    Phase,
    TaskKey,
)
from cdgui.domain.target import ConnectionKind, Endpoint, Target

NOW = datetime(2026, 11, 26, 22, 50, 0)


def make_target(remote: bool = False) -> Target:
    if remote:
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
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL, binary_dir="/opt", data_dir="/d"
        ),
        binary="/opt/chat-deepseek",
        data_dir="/d",
    )


def identity(
    username: str = "me", groups: tuple[str, ...] = ("User",)
) -> parsing.Identity:
    return parsing.Identity(
        username=username,
        groups=groups,
        expires_at=datetime(2026, 11, 26, 23, 0, 0),
    )


def user(
    username: str = "alice",
    groups: tuple[str, ...] = ("User",),
    *,
    disabled: bool = False,
) -> parsing.User:
    return parsing.User(
        username=username, groups=groups, disabled=disabled, id=username
    )


def make_state(
    *,
    remote: bool = False,
    host_present: bool = True,
    initialized: bool = True,
    public_url: str = "",
    listen: str = "127.0.0.1:8090",
    service: ServiceStatus | None = None,
    identity_groups: tuple[str, ...] | None = None,
    users: tuple[parsing.User, ...] = (),
    backups: tuple[parsing.Backup, ...] = (),
    selected: str | None = None,
    selected_backup: str | None = None,
    foreground: ForegroundSession | None = None,
    info_error: str | None = None,
    inflight: tuple[TaskKey, ...] = (),
    phase: Phase = Phase.READY,
    closing: bool = False,
) -> AppState:
    target = make_target(remote)
    hosts: dict[str, HostConfig] = {}
    if host_present:
        hosts[target.key] = HostConfig(
            target_key=target.key,
            version="0.1.4",
            os="linux",
            arch="amd64",
            initialized=initialized,
            listen=listen,
            public_url=public_url,
            api_origin="https://api.deepseek.com",
            backup_dir="/d/backups",
            service=service or ServiceStatus(supported=True),
            data_dir="/d",
        )
    entries = {
        key: InflightEntry(task_key=key, target_key=target.key, generation=1)
        for key in inflight
    }
    return AppState(
        target=target,
        hosts=hosts,
        identity=None if identity_groups is None else identity(groups=identity_groups),
        users=users,
        backups=backups,
        selected=selected,
        selected_backup=selected_backup,
        foreground=foreground,
        inflight=entries,
        info_error=info_error,
        page=PageId.SERVICE,
        phase=phase,
        closing=closing,
    )


def verdict(state: AppState, action: ActionId) -> rules.Verdict:
    return action_verdict(state, action, NOW)


class TableTest(unittest.TestCase):
    def test_every_action_has_a_verdict(self) -> None:
        state = make_state()
        for action in ActionId:
            with self.subTest(action=action):
                result = action_verdict(state, action, NOW)
                self.assertIsInstance(result, rules.Verdict)
                if result.enabled:
                    self.assertTrue(result.visible)
                self.assertIsInstance(result.reason, ActionReason)

    def test_missing_entry_raises(self) -> None:
        state = make_state()
        removed = rules._VERDICTS.pop(ActionId.HELP)
        try:
            with self.assertRaises(rules.MissingVerdictError):
                action_verdict(state, ActionId.HELP, NOW)
        finally:
            rules._VERDICTS[ActionId.HELP] = removed

    def test_unknown_action_raises(self) -> None:
        with self.assertRaises(rules.MissingVerdictError):
            action_verdict(make_state(), "not-an-action", NOW)

    def test_accepts_enum_name(self) -> None:
        self.assertTrue(action_verdict(make_state(), "START", NOW).enabled)


class BusyAndClosingTest(unittest.TestCase):
    def test_busy_disables_actions_with_baseline_toast(self) -> None:
        state = make_state(inflight=(TaskKey.INFO,))
        for action in (ActionId.START, ActionId.OPEN_PAGE, ActionId.HELP):
            result = verdict(state, action)
            self.assertFalse(result.enabled)
            self.assertIs(result.reason, ActionReason.BUSY)
            self.assertEqual(result.tooltip, "正在执行上一条命令")

    def test_closing_disables_actions(self) -> None:
        state = make_state(phase=Phase.CLOSING, closing=True)
        result = verdict(state, ActionId.START)
        self.assertFalse(result.enabled)
        self.assertIs(result.reason, ActionReason.CLOSING)
        self.assertEqual(result.tooltip, "正在关闭窗口")


class ServiceMatrixTest(unittest.TestCase):
    def test_info_pending(self) -> None:
        state = make_state(host_present=False)
        self.assertTrue(verdict(state, ActionId.START).enabled)
        self.assertEqual(verdict(state, ActionId.START).text, "启动")
        self.assertFalse(verdict(state, ActionId.STOP).enabled)
        self.assertFalse(verdict(state, ActionId.RESTART).visible)
        self.assertFalse(verdict(state, ActionId.INSTALL).visible)
        self.assertFalse(verdict(state, ActionId.UPDATE).visible)
        self.assertFalse(verdict(state, ActionId.UNINSTALL).visible)
        self.assertFalse(verdict(state, ActionId.OPEN_PAGE).enabled)
        self.assertFalse(verdict(state, ActionId.LOGIN).enabled)
        self.assertEqual(verdict(state, ActionId.LOGIN).tooltip, "先创建 Owner")
        self.assertTrue(verdict(state, ActionId.SETUP_OWNER).visible)
        save = verdict(state, ActionId.SETTINGS_SAVE_SERVER)
        self.assertFalse(save.enabled)
        self.assertIs(save.reason, ActionReason.INFO_PENDING)

    def test_uninitialized(self) -> None:
        state = make_state(initialized=False)
        self.assertTrue(verdict(state, ActionId.START).enabled)
        self.assertFalse(verdict(state, ActionId.INSTALL).enabled)
        self.assertEqual(
            verdict(state, ActionId.INSTALL).tooltip, "先初始化数据目录"
        )
        self.assertFalse(verdict(state, ActionId.BACKUP_NOW).enabled)
        self.assertEqual(
            verdict(state, ActionId.BACKUP_NOW).tooltip,
            "数据目录还没有初始化",
        )
        self.assertFalse(verdict(state, ActionId.LOGIN).enabled)
        self.assertEqual(verdict(state, ActionId.LOGIN).tooltip, "先创建 Owner")
        self.assertTrue(verdict(state, ActionId.SETUP_OWNER).visible)

    def test_foreground_mode(self) -> None:
        state = make_state()
        start = verdict(state, ActionId.START)
        self.assertTrue(start.enabled)
        self.assertEqual(start.tooltip, "以前台进程启动，关闭窗口会停止")
        self.assertFalse(verdict(state, ActionId.STOP).enabled)
        self.assertEqual(
            verdict(state, ActionId.STOP).tooltip, "服务没有在运行"
        )
        self.assertTrue(verdict(state, ActionId.INSTALL).visible)
        self.assertFalse(verdict(state, ActionId.UPDATE).visible)
        self.assertIs(rules.service_mode(state), rules.ServiceMode.FOREGROUND)

    def test_systemd_running(self) -> None:
        service = ServiceStatus(
            supported=True, installed=True, active=True, enabled=True
        )
        state = make_state(service=service)
        self.assertFalse(verdict(state, ActionId.START).enabled)
        self.assertEqual(
            verdict(state, ActionId.START).tooltip, "服务已经在运行"
        )
        self.assertTrue(verdict(state, ActionId.STOP).enabled)
        restart = verdict(state, ActionId.RESTART)
        self.assertTrue(restart.visible)
        self.assertTrue(restart.enabled)
        self.assertTrue(verdict(state, ActionId.OPEN_PAGE).enabled)
        self.assertFalse(verdict(state, ActionId.INSTALL).visible)
        self.assertTrue(verdict(state, ActionId.UPDATE).visible)
        self.assertTrue(verdict(state, ActionId.UPDATE).enabled)
        self.assertTrue(verdict(state, ActionId.UNINSTALL).visible)
        self.assertTrue(verdict(state, ActionId.UNINSTALL).enabled)
        self.assertIs(rules.service_mode(state), rules.ServiceMode.SYSTEMD)

    def test_systemd_installed_stopped(self) -> None:
        service = ServiceStatus(supported=True, installed=True, active=False)
        state = make_state(service=service)
        start = verdict(state, ActionId.START)
        self.assertTrue(start.enabled)
        self.assertEqual(start.tooltip, "通过 systemd 用户服务启动")
        self.assertFalse(verdict(state, ActionId.STOP).enabled)
        restart = verdict(state, ActionId.RESTART)
        self.assertTrue(restart.visible)
        self.assertFalse(restart.enabled)
        self.assertEqual(
            restart.tooltip, "服务没有在运行，先用“启动服务”"
        )
        self.assertFalse(verdict(state, ActionId.OPEN_PAGE).enabled)

    def test_platform_without_systemd(self) -> None:
        state = make_state(service=ServiceStatus(supported=False))
        self.assertTrue(verdict(state, ActionId.START).enabled)
        self.assertFalse(verdict(state, ActionId.INSTALL).visible)
        self.assertFalse(verdict(state, ActionId.UPDATE).visible)
        self.assertFalse(verdict(state, ActionId.RESTART).visible)
        self.assertIs(rules.service_mode(state), rules.ServiceMode.UNSUPPORTED)

    def test_foreground_running(self) -> None:
        target = make_target()
        foreground = ForegroundSession(
            target_key=target.key,
            phase=ForegroundPhase.RUNNING,
            address="127.0.0.1:8090",
            url="http://127.0.0.1:8090",
        )
        state = make_state(foreground=foreground)
        self.assertFalse(verdict(state, ActionId.START).enabled)
        self.assertTrue(verdict(state, ActionId.STOP).enabled)
        self.assertFalse(verdict(state, ActionId.RESTART).visible)
        self.assertTrue(verdict(state, ActionId.INSTALL).visible)
        self.assertTrue(verdict(state, ActionId.INSTALL).enabled)
        self.assertTrue(verdict(state, ActionId.OPEN_PAGE).enabled)
        self.assertTrue(rules.is_running(state))

    def test_foreground_stopping(self) -> None:
        target = make_target()
        foreground = ForegroundSession(
            target_key=target.key, phase=ForegroundPhase.STOPPING
        )
        state = make_state(foreground=foreground)
        for action in (ActionId.START, ActionId.STOP, ActionId.OPEN_PAGE):
            result = verdict(state, action)
            self.assertFalse(result.enabled)
            self.assertIs(result.reason, ActionReason.STOPPING)

    def test_restart_while_stopping(self) -> None:
        target = make_target()
        service = ServiceStatus(supported=True, installed=True, active=True)
        state = make_state(
            service=service,
            foreground=ForegroundSession(
                target_key=target.key, phase=ForegroundPhase.STOPPING
            ),
        )
        result = verdict(state, ActionId.RESTART)
        self.assertTrue(result.visible)
        self.assertFalse(result.enabled)
        self.assertIs(result.reason, ActionReason.STOPPING)

    def test_remote_public_url_rules(self) -> None:
        service = ServiceStatus(supported=True, installed=True, active=True)
        state = make_state(remote=True, service=service, public_url="")
        open_page = verdict(state, ActionId.OPEN_PAGE)
        self.assertFalse(open_page.visible)
        self.assertEqual(rules.page_url(state), "")
        self.assertTrue(verdict(state, ActionId.START).enabled is False)
        self.assertFalse(verdict(state, ActionId.BACKUP_AS).visible)
        with_url = make_state(
            remote=True,
            service=service,
            public_url="https://chat.example.com/",
        )
        self.assertEqual(rules.page_url(with_url), "https://chat.example.com")
        self.assertTrue(verdict(with_url, ActionId.OPEN_PAGE).visible)
        self.assertTrue(verdict(with_url, ActionId.OPEN_PAGE).enabled)

    def test_remote_foreground_url_is_not_openable(self) -> None:
        target = make_target(remote=True)
        foreground = ForegroundSession(
            target_key=target.key,
            phase=ForegroundPhase.RUNNING,
            url="http://127.0.0.1:8090",
        )
        state = make_state(
            remote=True, foreground=foreground, public_url=""
        )
        self.assertEqual(rules.page_url(state), "")


class AccountMatrixTest(unittest.TestCase):
    def test_logged_out_initialized(self) -> None:
        state = make_state()
        self.assertTrue(verdict(state, ActionId.LOGIN).enabled)
        self.assertTrue(verdict(state, ActionId.REFRESH_USERS).enabled)
        self.assertTrue(verdict(state, ActionId.ADD_USER).enabled)
        reset = verdict(state, ActionId.RESET_PASSWORD)
        self.assertFalse(reset.enabled)
        self.assertEqual(reset.tooltip, "请先登录")
        self.assertTrue(verdict(state, ActionId.BACKUP_NOW).enabled)
        self.assertEqual(
            verdict(state, ActionId.BACKUP_NOW).tooltip, "登录后可以创建备份"
        )
        self.assertTrue(verdict(state, ActionId.MANAGE_BACKUPS).enabled)
        self.assertFalse(verdict(state, ActionId.LOGOUT).visible)
        self.assertEqual(
            rules.backup_reason(state),
            "",
        )

    def test_admin_cannot_manage_backups_or_groups(self) -> None:
        admin = user("me", ("User", "Admin"))
        alice = user("alice", ("User",))
        bob = user("bob", ("User", "Admin"))
        state = make_state(
            identity_groups=("User", "Admin"),
            users=(admin, alice, bob),
            selected="alice",
        )
        backup = verdict(state, ActionId.BACKUP_NOW)
        self.assertFalse(backup.enabled)
        self.assertEqual(backup.tooltip, "需要 Owner 权限")
        self.assertEqual(rules.backup_reason(state), "需要 Owner 权限")
        self.assertTrue(verdict(state, ActionId.RESET_PASSWORD).enabled)
        self.assertTrue(verdict(state, ActionId.TOGGLE_USER).enabled)
        self.assertTrue(verdict(state, ActionId.DELETE_USER).enabled)
        self.assertTrue(verdict(state, ActionId.REFRESH_USERS).enabled)
        self.assertTrue(verdict(state, ActionId.ADD_USER).enabled)
        grant = verdict(state, ActionId.GRANT)
        self.assertFalse(grant.enabled)
        self.assertEqual(grant.tooltip, "需要 Owner 权限")

        other_admin = make_state(
            identity_groups=("User", "Admin"),
            users=(admin, alice, bob),
            selected="bob",
        )
        reset_admin = verdict(other_admin, ActionId.RESET_PASSWORD)
        self.assertFalse(reset_admin.enabled)
        self.assertEqual(
            reset_admin.tooltip, "只能操作权限低于自己的账户"
        )

        self_state = make_state(
            identity_groups=("User", "Admin"),
            users=(admin, alice),
            selected="me",
        )
        toggle_self = verdict(self_state, ActionId.TOGGLE_USER)
        self.assertFalse(toggle_self.enabled)
        self.assertEqual(toggle_self.tooltip, "不能操作自己")
        delete_self = verdict(self_state, ActionId.DELETE_USER)
        self.assertFalse(delete_self.enabled)
        self.assertEqual(delete_self.tooltip, "不能删除自己")

    def test_owner_can_manage_groups_and_backups(self) -> None:
        owner = user("me", ("User", "Owner"))
        alice = user("alice", ("User",))
        state = make_state(
            identity_groups=("User", "Owner"),
            users=(owner, alice),
            selected="alice",
        )
        self.assertTrue(verdict(state, ActionId.GRANT).enabled)
        self.assertTrue(verdict(state, ActionId.REVOKE).enabled)
        self.assertTrue(verdict(state, ActionId.BACKUP_NOW).enabled)
        self.assertTrue(verdict(state, ActionId.BACKUP_AS).enabled)
        self.assertTrue(verdict(state, ActionId.DELETE_USER).enabled)
        self.assertEqual(rules.backup_reason(state), "")

        self_state = make_state(
            identity_groups=("User", "Owner"),
            users=(owner, alice),
            selected="me",
        )
        self.assertTrue(verdict(self_state, ActionId.RESET_PASSWORD).enabled)
        self.assertEqual(
            verdict(self_state, ActionId.TOGGLE_USER).tooltip,
            "不能操作自己",
        )

    def test_restore_requires_selected_backup(self) -> None:
        owner = user("me", ("User", "Owner"))
        items = (
            parsing.Backup("a.zip", "1 MB", datetime(2026, 11, 26, 12, 0)),
        )
        no_selection = make_state(
            identity_groups=("User", "Owner"),
            users=(owner,),
            backups=items,
        )
        result = verdict(no_selection, ActionId.RESTORE)
        self.assertFalse(result.enabled)
        self.assertEqual(result.reason, "先选择一个备份")
        self.assertEqual(result.tooltip, "先选择一个备份")
        selected = make_state(
            identity_groups=("User", "Owner"),
            users=(owner,),
            backups=items,
            selected_backup="a.zip",
        )
        self.assertTrue(verdict(selected, ActionId.RESTORE).enabled)

    def test_info_error_state_keeps_retry_affordance(self) -> None:
        state = make_state(info_error="无法读取服务状态")
        self.assertEqual(state.info_error, "无法读取服务状态")
        self.assertTrue(rules.data_ready(state))

    def test_plain_user_cannot_manage(self) -> None:
        state = make_state(
            identity_groups=("User",),
            users=(user("me"), user("alice")),
            selected="alice",
        )
        refresh = verdict(state, ActionId.REFRESH_USERS)
        self.assertFalse(refresh.enabled)
        self.assertEqual(refresh.tooltip, "需要 Admin 或 Owner 权限")
        add = verdict(state, ActionId.ADD_USER)
        self.assertFalse(add.enabled)
        self.assertEqual(add.tooltip, "需要 Admin 或 Owner 权限")
        self.assertEqual(
            verdict(state, ActionId.BACKUP_NOW).tooltip, "需要 Owner 权限"
        )

    def test_no_selection_has_empty_tooltip(self) -> None:
        state = make_state(
            identity_groups=("User", "Owner"),
            users=(user("me", ("User", "Owner")),),
        )
        for action in (
            ActionId.RESET_PASSWORD,
            ActionId.TOGGLE_USER,
            ActionId.GRANT,
            ActionId.REVOKE,
            ActionId.DELETE_USER,
        ):
            result = verdict(state, action)
            self.assertFalse(result.enabled)
            self.assertIs(result.reason, ActionReason.NO_SELECTION)
            self.assertEqual(result.tooltip, "")

    def test_disabled_user_toggle_text(self) -> None:
        state = make_state(
            identity_groups=("User", "Owner"),
            users=(user("me", ("User", "Owner")), user("alice", disabled=True)),
            selected="alice",
        )
        self.assertEqual(verdict(state, ActionId.TOGGLE_USER).text, "启用")

    def test_logged_in_hides_login_and_shows_logout(self) -> None:
        state = make_state(identity_groups=("User",))
        self.assertFalse(verdict(state, ActionId.LOGIN).visible)
        self.assertTrue(verdict(state, ActionId.LOGOUT).visible)
        self.assertTrue(verdict(state, ActionId.LOGOUT).enabled)


class UrlAndDerivedTest(unittest.TestCase):
    def test_page_url_local_precedence(self) -> None:
        state = make_state(listen="0.0.0.0:8090")
        self.assertEqual(rules.page_url(state), "http://127.0.0.1:8090")
        with_public = make_state(public_url="https://chat.example.com/")
        self.assertEqual(rules.page_url(with_public), "https://chat.example.com")
        target = make_target()
        foreground = ForegroundSession(
            target_key=target.key,
            phase=ForegroundPhase.RUNNING,
            url="http://127.0.0.1:9999",
        )
        both = make_state(
            public_url="https://chat.example.com/", foreground=foreground
        )
        self.assertEqual(rules.page_url(both), "http://127.0.0.1:9999")

    def test_page_url_listen_normalization(self) -> None:
        for listen, expected in (
            ("0.0.0.0:8090", "http://127.0.0.1:8090"),
            ("[::]:8090", "http://127.0.0.1:8090"),
            ("8090", "http://127.0.0.1:8090"),
            (":8090", "http://127.0.0.1:8090"),
        ):
            with self.subTest(listen=listen):
                self.assertEqual(
                    rules.page_url(make_state(listen=listen)), expected
                )

    def test_data_ready(self) -> None:
        self.assertFalse(rules.data_ready(make_state(initialized=False)))
        self.assertTrue(rules.data_ready(make_state()))
        self.assertTrue(rules.data_ready(make_state(initialized=False, identity_groups=("User",))))

    def test_service_mode_unknown(self) -> None:
        self.assertIs(
            rules.service_mode(make_state(host_present=False)),
            rules.ServiceMode.UNKNOWN,
        )

    def test_remaining_text(self) -> None:
        current = identity()
        self.assertEqual(rules.remaining_seconds(current, NOW), 600)
        self.assertEqual(rules.remaining_text(current, NOW), "10 分钟后过期")
        late = datetime(2026, 11, 26, 23, 1)
        self.assertEqual(rules.remaining_seconds(current, late), 0)
        self.assertEqual(rules.remaining_text(current, late), "已过期")

    def test_backup_reason_variants(self) -> None:
        self.assertEqual(
            rules.backup_reason(make_state(initialized=False)),
            "数据目录还没有初始化",
        )
        self.assertEqual(
            rules.backup_reason(make_state(identity_groups=("User", "Admin"))),
            "需要 Owner 权限",
        )
        self.assertEqual(rules.backup_reason(make_state()), "")
        self.assertEqual(rules.backup_reason(make_state()), "")


class SettingsTest(unittest.TestCase):
    def test_save_server_requires_info(self) -> None:
        state = make_state(host_present=False)
        self.assertIs(
            verdict(state, ActionId.SETTINGS_SAVE_SERVER).reason,
            ActionReason.INFO_PENDING,
        )
        self.assertTrue(verdict(make_state(), ActionId.SETTINGS_SAVE_SERVER).enabled)

    def test_settings_actions_are_visible(self) -> None:
        state = make_state()
        for action in (
            ActionId.SETTINGS_SAVE_CONNECTION,
            ActionId.SETTINGS_APPLY_TARGET,
            ActionId.TEST_CONNECTION,
            ActionId.SETTINGS_SAVE_SERVER,
        ):
            self.assertTrue(verdict(state, action).visible)


if __name__ == "__main__":
    unittest.main()
