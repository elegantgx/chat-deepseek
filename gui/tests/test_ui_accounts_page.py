"""C5c 账户页测试：列表、选择、五个动作、空态与键盘。"""

from __future__ import annotations

import os
import sys
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtCore import Qt
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication

import parsing
import theme
from cdgui.domain.facts import HostConfig, ServiceStatus
from cdgui.domain.state import AppState
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.ui.pages import accounts as accounts_page
from cdgui.ui.pages.accounts import AccountsPage
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


def host_for(target: Target, *, initialized: bool = True) -> HostConfig:
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
        service=ServiceStatus(supported=True),
        data_dir=target.data_dir,
    )


def user(
    username: str,
    groups: tuple[str, ...] = ("User",),
    disabled: bool = False,
) -> parsing.User:
    return parsing.User(
        username=username,
        groups=groups,
        disabled=disabled,
        id=f"id-{username}",
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


def state_for(
    target: Target,
    host: HostConfig | None,
    *,
    who: parsing.Identity | None = None,
    users: tuple[parsing.User, ...] = (),
    selected: str | None = None,
) -> AppState:
    hosts = {target.key: host} if host is not None else {}
    return AppState(
        target=target,
        hosts=hosts,
        identity=who,
        users=users,
        selected=selected,
    )


class FakeController:
    """账户页替身：记录调用，并让 select_user 反映到 state。"""

    def __init__(self, state: AppState) -> None:
        self._state = state
        self.calls: list[tuple[str, tuple, dict]] = []

    @property
    def state(self) -> AppState:
        return self._state

    @property
    def service_user(self) -> str:
        return "gx"

    def set_state(self, state: AppState) -> None:
        self._state = state

    def _record(self, name: str, *args, **kwargs) -> None:
        self.calls.append((name, args, kwargs))

    def names(self) -> list[str]:
        return [call[0] for call in self.calls]

    def set_page(self, page) -> None:
        self._record("set_page", page)

    def refresh_users(self) -> None:
        self._record("refresh_users")

    def select_user(self, username) -> None:
        self._record("select_user", username)
        self._state = replace(self._state, selected=username)

    def ensure_login(self, then=None) -> bool:
        self._record("ensure_login", then)
        return False

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


class FakeAccountForm:
    instances: list["FakeAccountForm"] = []
    value: tuple | None = ("new", "password123", ())

    def __init__(self, parent, mode="owner", allow_groups=False) -> None:
        self.parent = parent
        self.mode = mode
        self.allow_groups = allow_groups
        FakeAccountForm.instances.append(self)

    def exec_modal(self):
        return FakeAccountForm.value


class FakePasswordForm:
    instances: list["FakePasswordForm"] = []
    value: object = "newpass123"

    def __init__(self, parent, username="") -> None:
        self.username = username
        FakePasswordForm.instances.append(self)

    def exec_modal(self):
        return FakePasswordForm.value


class FakeGroupForm:
    instances: list["FakeGroupForm"] = []
    value: object = "Admin"

    def __init__(self, parent, username="", add=True) -> None:
        self.username = username
        self.add = add
        FakeGroupForm.instances.append(self)

    def exec_modal(self):
        return FakeGroupForm.value


def make_page(
    state: AppState, *, size: tuple[int, int] = (900, 700)
) -> tuple[AccountsPage, FakeController]:
    controller = FakeController(state)
    page = AccountsPage(controller)
    page.widget.resize(*size)
    page.widget.show()
    page.render(derive_ui(state, NOW), state)
    QApplication.processEvents()
    return page, controller


def rerender(page: AccountsPage, controller: FakeController, state: AppState) -> None:
    controller.set_state(state)
    page.render(derive_ui(state, NOW), state)
    QApplication.processEvents()


class AccountsPageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        self._dark_hint = theme._dark_hint
        theme._dark_hint = False
        self.pages: list[AccountsPage] = []

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

    # -- 列表 --------------------------------------------------------------

    def test_rows_count_and_usernames(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob"), user("carol"))
        page, _ = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )

        self.assertEqual([row.key for row in page._rows], ["alice", "bob", "carol"])
        self.assertEqual(page.count_badge.text(), "3")
        self.assertFalse(page.empty.isVisible())
        self.assertTrue(page.scroll.isVisible())

    def test_group_badges_are_sorted_with_role_colors(self) -> None:
        target = local_target()
        people = (user("alice", ("User", "Admin")),)
        page, _ = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )
        row = page._rows[0]

        self.assertEqual(
            [badge.text() for badge in row.group_badges], ["Admin", "User"]
        )
        self.assertEqual(row.group_badges[0].tone(), "warning")
        self.assertEqual(row.group_badges[1].tone(), "muted")

    def test_owner_badge_uses_primary_tone(self) -> None:
        target = local_target()
        people = (user("owner", ("Owner",)),)
        page, _ = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity("owner"),
                users=people,
            )
        )
        row = page._rows[0]

        self.assertEqual(row.group_badges[0].text(), "Owner")
        self.assertEqual(row.group_badges[0].tone(), "primary")

    def test_disabled_row_uses_muted_style_and_danger_badge(self) -> None:
        target = local_target()
        people = (user("alice", disabled=True), user("bob"))
        page, _ = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )
        disabled_row = page._rows[0]
        enabled_row = page._rows[1]

        self.assertTrue(disabled_row.disabled)
        self.assertEqual(disabled_row.title.property("tone"), "muted")
        self.assertTrue(disabled_row.avatar._disabled)
        self.assertEqual(disabled_row.status_badge.text(), "已禁用")
        self.assertEqual(disabled_row.status_badge.tone(), "danger")

        self.assertFalse(enabled_row.disabled)
        self.assertEqual(enabled_row.title.property("tone"), "text")
        self.assertEqual(enabled_row.status_badge.text(), "正常")
        self.assertEqual(enabled_row.status_badge.tone(), "success")

    # -- 选择 --------------------------------------------------------------

    def test_click_row_selects_by_username(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob"))
        page, controller = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )

        QTest.mouseClick(page._rows[1], Qt.MouseButton.LeftButton)
        self.assertEqual(controller.names(), ["select_user"])
        self.assertEqual(controller.calls[0][1][0], "bob")

        rerender(page, controller, controller.state)
        self.assertTrue(page._rows[1].is_selected())
        self.assertFalse(page._rows[0].is_selected())
        self.assertEqual(page.selection_label.text(), "已选择")
        self.assertEqual(page.selection_name.text(), "bob")

    def test_cancel_selection_clears_state(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob"))
        page, controller = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity(),
                users=people,
                selected="bob",
            )
        )

        self.assertTrue(page._rows[1].is_selected())
        page.clear_button.click()
        self.assertEqual(controller.names(), ["select_user"])
        self.assertIsNone(controller.calls[0][1][0])

        rerender(page, controller, controller.state)
        self.assertFalse(any(row.is_selected() for row in page._rows))
        self.assertEqual(page.selection_label.text(), "账户操作")
        self.assertFalse(page.clear_button.isVisible())

    def test_no_selection_disables_account_actions(self) -> None:
        target = local_target()
        people = (user("alice"),)
        page, _ = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )

        for button in (
            page.reset_button,
            page.toggle_button,
            page.grant_button,
            page.revoke_button,
            page.delete_button,
        ):
            self.assertFalse(button.isEnabled())
        self.assertFalse(page.clear_button.isVisible())

    # -- 五个动作 ----------------------------------------------------------

    def test_reset_password_uses_password_form(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob"))
        page, controller = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity(),
                users=people,
                selected="bob",
            )
        )
        FakePasswordForm.instances = []
        FakePasswordForm.value = "newpass123"

        with mock.patch.object(
            accounts_page, "PasswordForm", FakePasswordForm
        ):
            page.reset_button.click()

        self.assertEqual(FakePasswordForm.instances[0].username, "bob")
        self.assertEqual(controller.names(), ["reset_password"])
        self.assertEqual(controller.calls[0][1], ("bob", "newpass123"))

    def test_toggle_user_disables_and_enables(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob", disabled=True))
        page, controller = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity(),
                users=people,
                selected="alice",
            )
        )

        page.toggle_button.click()
        self.assertEqual(controller.calls[0][1], ("alice", False))

        state = replace(controller.state, selected="bob")
        rerender(page, controller, state)
        self.assertEqual(page.toggle_button.text(), "启用")
        page.toggle_button.click()
        self.assertEqual(controller.calls[1][1], ("bob", True))

    def test_grant_and_revoke_use_group_form(self) -> None:
        target = local_target()
        people = (user("alice"),)
        page, controller = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity(),
                users=people,
                selected="alice",
            )
        )
        FakeGroupForm.instances = []
        FakeGroupForm.value = "Admin"

        with mock.patch.object(accounts_page, "GroupForm", FakeGroupForm):
            page.grant_button.click()
            page.revoke_button.click()

        self.assertEqual(
            [form.add for form in FakeGroupForm.instances], [True, False]
        )
        self.assertEqual(controller.calls[0][1], ("alice", "Admin", True))
        self.assertEqual(controller.calls[1][1], ("alice", "Admin", False))

    def test_delete_requires_danger_confirmation(self) -> None:
        target = local_target()
        people = (user("alice"),)
        page, controller = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity(),
                users=people,
                selected="alice",
            )
        )

        with mock.patch.object(
            accounts_page, "ask_confirm", return_value=False
        ) as confirm:
            page.delete_button.click()
        self.assertEqual(controller.names(), [])
        self.assertTrue(confirm.call_args.kwargs["danger"])

        with mock.patch.object(
            accounts_page, "ask_confirm", return_value=True
        ):
            page.delete_button.click()
        self.assertEqual(controller.names(), ["delete_user"])
        self.assertEqual(controller.calls[0][1], ("alice",))

    # -- 权限矩阵 ----------------------------------------------------------

    def test_admin_verdicts_limit_targets_to_lower_rank(self) -> None:
        target = local_target()
        admin = user("admin", ("Admin", "User"))
        owner = user("owner", ("Owner",))
        normal = user("normal")
        people = (admin, owner, normal)
        page, controller = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity("admin", ("Admin",)),
                users=people,
                selected="normal",
            )
        )

        self.assertTrue(page.reset_button.isEnabled())
        self.assertTrue(page.toggle_button.isEnabled())
        self.assertTrue(page.delete_button.isEnabled())
        self.assertFalse(page.grant_button.isEnabled())
        self.assertFalse(page.revoke_button.isEnabled())
        self.assertEqual(page.grant_button.toolTip(), "需要 Owner 权限")

        owner_state = replace(controller.state, selected="owner")
        rerender(page, controller, owner_state)
        self.assertFalse(page.reset_button.isEnabled())
        self.assertFalse(page.toggle_button.isEnabled())
        self.assertFalse(page.delete_button.isEnabled())

    def test_owner_cannot_disable_or_delete_self(self) -> None:
        target = local_target()
        people = (user("gx", ("Owner",)), user("bob"))
        page, _ = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity(),
                users=people,
                selected="gx",
            )
        )

        self.assertTrue(page.reset_button.isEnabled())
        self.assertFalse(page.toggle_button.isEnabled())
        self.assertEqual(page.toggle_button.toolTip(), "不能操作自己")
        self.assertFalse(page.delete_button.isEnabled())
        self.assertEqual(page.delete_button.toolTip(), "不能删除自己")

    # -- 空态 --------------------------------------------------------------

    def test_empty_loading_when_info_missing(self) -> None:
        target = local_target()
        page, _ = self.build_page(state_for(target, None))

        self.assertEqual(page._empty_mode, "loading")
        self.assertEqual(page.empty_title.text(), "正在读取账户状态…")
        self.assertFalse(page.scroll.isVisible())
        self.assertTrue(page.empty.isVisible())
        self.assertFalse(page.empty_button.isVisible())

    def test_empty_setup_owner_creates_first_owner(self) -> None:
        target = local_target()
        host = host_for(target, initialized=False)
        page, controller = self.build_page(state_for(target, host))
        FakeAccountForm.instances = []
        FakeAccountForm.value = ("root", "password123", ())

        self.assertEqual(page._empty_mode, "setup_owner")
        self.assertTrue(page.empty_plus.isVisible())
        self.assertFalse(page.empty_lock.isVisible())
        self.assertEqual(page.empty_title.text(), "还没有账户")
        self.assertIn("创建第一个 Owner", page.empty_text.text())
        self.assertEqual(page.empty_button.text(), "创建 Owner")

        with mock.patch.object(
            accounts_page, "AccountForm", FakeAccountForm
        ):
            page.empty_button.click()

        self.assertEqual(FakeAccountForm.instances[0].mode, "owner")
        self.assertEqual(controller.names(), ["setup_owner"])
        self.assertEqual(controller.calls[0][1], ("root", "password123"))

    def test_empty_locked_asks_for_login(self) -> None:
        target = local_target()
        page, controller = self.build_page(
            state_for(target, host_for(target))
        )

        self.assertEqual(page._empty_mode, "login")
        self.assertTrue(page.empty_lock.isVisible())
        self.assertFalse(page.empty_plus.isVisible())
        self.assertEqual(page.empty_title.text(), "登录后管理账户")
        self.assertEqual(page.empty_button.text(), "登录")
        page.empty_button.click()
        self.assertEqual(controller.names(), ["ensure_login"])

    def test_empty_logged_in_without_users_offers_add(self) -> None:
        target = local_target()
        page, controller = self.build_page(
            state_for(target, host_for(target), who=identity(), users=())
        )
        FakeAccountForm.instances = []
        FakeAccountForm.value = ("new", "password123", ())

        self.assertEqual(page._empty_mode, "empty")
        self.assertTrue(page.empty_plus.isVisible())
        self.assertEqual(page.empty_title.text(), "还没有账户")
        with mock.patch.object(
            accounts_page, "AccountForm", FakeAccountForm
        ):
            page.empty_button.click()

        self.assertEqual(FakeAccountForm.instances[0].mode, "user")
        self.assertEqual(controller.names(), ["add_user"])

    # -- 添加账户 ----------------------------------------------------------

    def test_add_user_as_owner_allows_groups(self) -> None:
        target = local_target()
        people = (user("gx", ("Owner",)),)
        page, controller = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )
        FakeAccountForm.instances = []
        FakeAccountForm.value = ("new", "password123", ("Admin",))
        self.assertTrue(page.add_button.isEnabled())

        with mock.patch.object(
            accounts_page, "AccountForm", FakeAccountForm
        ):
            page.add_button.click()

        form = FakeAccountForm.instances[0]
        self.assertEqual(form.mode, "user")
        self.assertTrue(form.allow_groups)
        self.assertEqual(controller.names(), ["add_user"])
        self.assertEqual(
            controller.calls[0][1], ("new", "password123", ("Admin",))
        )

    def test_add_user_as_admin_hides_group_choices(self) -> None:
        target = local_target()
        people = (user("admin", ("Admin", "User")),)
        page, _ = self.build_page(
            state_for(
                target,
                host_for(target),
                who=identity("admin", ("Admin",)),
                users=people,
            )
        )
        FakeAccountForm.instances = []
        FakeAccountForm.value = None

        with mock.patch.object(
            accounts_page, "AccountForm", FakeAccountForm
        ):
            page.add_button.click()

        self.assertFalse(FakeAccountForm.instances[0].allow_groups)

    def test_header_verdicts_follow_data_and_login(self) -> None:
        target = local_target()
        uninitialized = self.build_page(
            state_for(target, host_for(target, initialized=False))
        )[0]
        self.assertFalse(uninitialized.refresh_button.isEnabled())
        self.assertFalse(uninitialized.add_button.isEnabled())

        logged_out = self.build_page(
            state_for(target, host_for(target))
        )[0]
        self.assertTrue(logged_out.add_button.isEnabled())
        self.assertEqual(logged_out.add_button.toolTip(), "登录后管理账户")

    # -- 键盘与滚动 --------------------------------------------------------

    def test_keyboard_up_down_moves_selection(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob"), user("carol"))
        page, controller = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )

        page._rows[0].setFocus()
        QTest.keyClick(page._rows[0], Qt.Key.Key_Down)
        self.assertEqual(controller.calls[-1][1][0], "bob")

        QTest.keyClick(page._rows[1], Qt.Key.Key_Up)
        self.assertEqual(controller.calls[-1][1][0], "alice")

    def test_space_toggles_selection(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob"))
        page, controller = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )

        page._rows[1].setFocus()
        QTest.keyClick(page._rows[1], Qt.Key.Key_Space)
        self.assertEqual(controller.calls[-1][1][0], "bob")

        rerender(page, controller, controller.state)
        QTest.keyClick(page._rows[1], Qt.Key.Key_Space)
        self.assertIsNone(controller.calls[-1][1][0])

    def test_enter_selects_focused_row(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob"))
        page, controller = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            )
        )

        page._rows[0].setFocus()
        QTest.keyClick(page._rows[0], Qt.Key.Key_Return)
        self.assertEqual(controller.calls[-1][1][0], "alice")

    def test_scroll_position_restored_after_rebuild(self) -> None:
        target = local_target()
        people = tuple(user(f"user{index:02d}") for index in range(25))
        page, controller = self.build_page(
            state_for(
                target, host_for(target), who=identity(), users=people
            ),
            size=(900, 520),
        )
        bar = page.scroll.verticalScrollBar()
        self.assertGreater(bar.maximum(), 120)
        bar.setValue(120)

        more = people + (user("user99"),)
        rerender(
            page,
            controller,
            state_for(
                target, host_for(target), who=identity(), users=more
            ),
        )
        self.assertEqual(bar.value(), 120)

    def test_selection_only_update_does_not_rebuild_rows(self) -> None:
        target = local_target()
        people = (user("alice"), user("bob"))
        state = state_for(
            target, host_for(target), who=identity(), users=people
        )
        page, controller = self.build_page(state)
        rows = list(page._rows)

        rerender(page, controller, replace(state, selected="bob"))

        self.assertIs(page._rows[0], rows[0])
        self.assertIs(page._rows[1], rows[1])
        self.assertTrue(page._rows[1].is_selected())


if __name__ == "__main__":
    unittest.main()
