from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import parsing

from cdgui.domain import reducers
from cdgui.domain.facts import (
    ForegroundPhase,
    ForegroundSession,
    HostConfig,
    ServiceStatus,
)
from cdgui.domain.state import (
    AppState,
    InflightEntry,
    LoginPrompt,
    Notice,
    NoticeTone,
    PageId,
    Phase,
    TaskKey,
    assert_invariants,
)
from cdgui.domain.target import ConnectionKind, Endpoint, Target


def target(remote: bool = False) -> Target:
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


def host(key: str, *, initialized: bool = True) -> HostConfig:
    return HostConfig(
        target_key=key,
        version="0.1.4",
        os="linux",
        arch="amd64",
        initialized=initialized,
        listen="127.0.0.1:8090",
        public_url="",
        api_origin="https://api.deepseek.com",
        backup_dir="/d/backups",
        service=ServiceStatus(supported=True),
        data_dir="/d",
    )


def identity(username: str = "me", groups: tuple[str, ...] = ("User",)) -> parsing.Identity:
    return parsing.Identity(
        username=username,
        groups=groups,
        expires_at=datetime(2026, 11, 26, 23, 0),
    )


def user(username: str = "alice", groups: tuple[str, ...] = ("User",)) -> parsing.User:
    return parsing.User(
        username=username, groups=groups, disabled=False, id=username
    )


def backup(name: str = "a.zip") -> parsing.Backup:
    return parsing.Backup(name, "1.0 MB", datetime(2026, 11, 26, 12, 0))


def base() -> AppState:
    return AppState(target=target(), phase=Phase.READY)


def logged_in() -> AppState:
    state = base()
    key = state.target.key
    return AppState(
        target=state.target,
        hosts={key: host(key)},
        identity=identity(),
        users=(user(),),
        backups=(backup(),),
        selected="alice",
        phase=Phase.READY,
    )


class ReducerInvariantMixin(unittest.TestCase):
    def assert_valid(self, *states: AppState) -> None:
        for state in states:
            assert_invariants(state)


class PageAndBootTest(ReducerInvariantMixin):
    def test_set_page(self) -> None:
        before = base()
        after = reducers.set_page(before, PageId.BACKUPS)
        self.assertIs(after.page, PageId.BACKUPS)
        self.assert_valid(before, after)

    def test_booted(self) -> None:
        before = AppState(target=target())
        after = reducers.booted(before)
        self.assertIs(after.phase, Phase.READY)
        self.assert_valid(before, after)
        self.assertIs(reducers.booted(after), after)

    def test_closing_started(self) -> None:
        before = logged_in()
        after = reducers.closing_started(before)
        self.assertTrue(after.closing)
        self.assertIs(after.phase, Phase.CLOSING)
        self.assertIsNone(after.login)
        self.assertIsNone(after.notice)
        self.assert_valid(before, after)


class TargetChangedTest(ReducerInvariantMixin):
    def test_clears_old_facts_and_keeps_page(self) -> None:
        before = reducers.set_page(logged_in(), PageId.ACCOUNTS)
        new_target = target(remote=True)
        after = reducers.target_changed(before, new_target)
        self.assertIs(after.target, new_target)
        self.assertEqual(dict(after.hosts), {})
        self.assertIsNone(after.identity)
        self.assertEqual(after.users, ())
        self.assertEqual(after.backups, ())
        self.assertIsNone(after.selected)
        self.assertIsNone(after.foreground)
        self.assertEqual(dict(after.inflight), {})
        self.assertIs(after.page, PageId.ACCOUNTS)
        self.assert_valid(before, after)

    def test_same_target_is_noop(self) -> None:
        before = logged_in()
        self.assertIs(reducers.target_changed(before, before.target), before)

    def test_target_changed_clears_info_error_and_backup_selection(self) -> None:
        before = reducers.select_backup(logged_in(), "a.zip")
        before = reducers.facts_failed(before, "boom")
        after = reducers.target_changed(before, target(remote=True))
        self.assertIsNone(after.info_error)
        self.assertIsNone(after.selected_backup)
        self.assert_valid(before, after)


class FactsTest(ReducerInvariantMixin):
    def test_facts_loaded_replaces_host(self) -> None:
        before = base()
        loaded = host(before.target.key, initialized=True)
        after = reducers.facts_loaded(before, loaded)
        self.assertEqual(after.hosts[before.target.key], loaded)
        self.assert_valid(before, after)

    def test_facts_loaded_wrong_target(self) -> None:
        with self.assertRaises(ValueError):
            reducers.facts_loaded(base(), host("other"))

    def test_facts_failed_clears_info_task_and_notifies(self) -> None:
        before = reducers.task_started(
            logged_in(), TaskKey.INFO, generation=3
        )
        after = reducers.facts_failed(before, "无法读取服务状态", "boom")
        self.assertNotIn(TaskKey.INFO, after.inflight)
        self.assertIsNotNone(after.notice)
        self.assertEqual(after.notice.text, "无法读取服务状态")
        self.assertIs(after.notice.tone, NoticeTone.ERROR)
        self.assertEqual(after.notice.details, "boom")
        self.assertEqual(after.info_error, "无法读取服务状态")
        # 旧 HostConfig 保留
        self.assertIn(before.target.key, after.hosts)
        self.assert_valid(before, after)

    def test_facts_loaded_clears_info_error(self) -> None:
        before = reducers.facts_failed(
            reducers.task_started(base(), TaskKey.INFO), "boom"
        )
        self.assertEqual(before.info_error, "boom")
        after = reducers.facts_loaded(before, host(before.target.key))
        self.assertIsNone(after.info_error)
        self.assert_valid(before, after)

    def test_facts_failed_without_message_keeps_notice(self) -> None:
        state = reducers.notice_raised(logged_in(), "keep")
        after = reducers.facts_failed(state)
        self.assertEqual(after.notice.text, "keep")

    def test_facts_failed_accepts_parsing_failure(self) -> None:
        before = reducers.task_started(logged_in(), TaskKey.INFO)
        failure = parsing.Failure("读取失败", "请检查远端连接", "raw")
        after = reducers.facts_failed(before, failure)
        self.assertEqual(after.notice.text, "请检查远端连接")
        self.assertEqual(after.notice.details, "raw")
        self.assertNotIn(TaskKey.INFO, after.inflight)
        self.assert_valid(before, after)


class IdentityAndListsTest(ReducerInvariantMixin):
    def test_identity_loaded_same_user_keeps_lists(self) -> None:
        before = logged_in()
        after = reducers.identity_loaded(before, identity())
        self.assertEqual(len(after.users), 1)
        self.assertEqual(after.selected, "alice")
        self.assert_valid(before, after)

    def test_identity_loaded_new_user_clears_lists(self) -> None:
        before = logged_in()
        after = reducers.identity_loaded(before, identity("root", ("User", "Owner")))
        self.assertEqual(after.identity.username, "root")
        self.assertEqual(after.users, ())
        self.assertEqual(after.backups, ())
        self.assertIsNone(after.selected)
        self.assert_valid(before, after)

    def test_identity_loaded_closes_login_prompt(self) -> None:
        before = reducers.login_prompt_set(
            base(), LoginPrompt("me", "密码错误")
        )
        after = reducers.identity_loaded(before, identity())
        self.assertIsNone(after.login)
        self.assert_valid(before, after)

    def test_auth_expired_clears_everything(self) -> None:
        before = reducers.select_backup(logged_in(), "a.zip")
        before = reducers.task_started(before, TaskKey.USERS, generation=1)
        after = reducers.auth_expired(before)
        self.assertIsNone(after.identity)
        self.assertEqual(after.users, ())
        self.assertEqual(after.backups, ())
        self.assertIsNone(after.selected)
        self.assertIsNone(after.selected_backup)
        self.assertEqual(dict(after.inflight), {})
        self.assertEqual(after.notice.text, "登录已过期，请重新登录")
        self.assert_valid(before, after)

    def test_users_loaded_keeps_selection_when_still_present(self) -> None:
        before = logged_in()
        after = reducers.users_loaded(before, (user("bob"), user("alice")))
        self.assertEqual(after.selected, "alice")
        self.assert_valid(before, after)

    def test_users_loaded_clears_missing_selection(self) -> None:
        before = logged_in()
        after = reducers.users_loaded(before, (user("bob"),))
        self.assertIsNone(after.selected)
        self.assert_valid(before, after)

    def test_backups_loaded(self) -> None:
        before = logged_in()
        after = reducers.backups_loaded(before, (backup("b.zip"), backup("c.zip")))
        self.assertEqual([item.name for item in after.backups], ["b.zip", "c.zip"])
        self.assert_valid(before, after)

    def test_backups_loaded_clears_missing_selection(self) -> None:
        before = reducers.select_backup(logged_in(), "a.zip")
        after = reducers.backups_loaded(before, (backup("b.zip"),))
        self.assertIsNone(after.selected_backup)
        self.assert_valid(before, after)

    def test_select_backup(self) -> None:
        before = logged_in()
        selected = reducers.select_backup(before, "a.zip")
        self.assertEqual(selected.selected_backup, "a.zip")
        cleared = reducers.select_backup(selected, None)
        self.assertIsNone(cleared.selected_backup)
        with self.assertRaises(ValueError):
            reducers.select_backup(before, "missing.zip")
        self.assert_valid(before, selected, cleared)

    def test_select_user(self) -> None:
        before = reducers.users_loaded(logged_in(), (user("alice"), user("bob")))
        after = reducers.select_user(before, "bob")
        self.assertEqual(after.selected, "bob")
        cleared = reducers.select_user(after, None)
        self.assertIsNone(cleared.selected)
        with self.assertRaises(ValueError):
            reducers.select_user(before, "carol")
        self.assert_valid(before, after, cleared)


class TaskAndPromptTest(ReducerInvariantMixin):
    def test_task_started_and_finished(self) -> None:
        before = base()
        started = reducers.task_started(
            before, TaskKey.INFO, generation=2
        )
        entry = started.inflight[TaskKey.INFO]
        self.assertEqual(entry.generation, 2)
        self.assertEqual(entry.target_key, before.target.key)
        self.assert_valid(before, started)
        finished = reducers.task_finished(started, TaskKey.INFO)
        self.assertNotIn(TaskKey.INFO, finished.inflight)
        self.assertIs(reducers.task_finished(finished, TaskKey.INFO), finished)
        self.assert_valid(finished)

    def test_task_started_rejects_duplicate_and_wrong_target(self) -> None:
        state = reducers.task_started(base(), TaskKey.USERS)
        with self.assertRaises(ValueError):
            reducers.task_started(state, TaskKey.USERS)
        with self.assertRaises(ValueError):
            reducers.task_started(base(), TaskKey.USERS, target_key="other")
        with self.assertRaises(ValueError):
            reducers.task_started(base(), TaskKey.USERS, generation=0)

    def test_login_prompt(self) -> None:
        prompt = LoginPrompt("alice", "密码错误")
        before = base()
        after = reducers.login_prompt_set(before, prompt)
        self.assertIs(after.login, prompt)
        self.assertIsNone(reducers.login_prompt_set(after, None).login)
        self.assert_valid(before, after)

    def test_notice(self) -> None:
        before = base()
        raised = reducers.notice_raised(before, "完成", tone=NoticeTone.SUCCESS)
        self.assertEqual(raised.notice.text, "完成")
        self.assertIs(raised.notice.tone, NoticeTone.SUCCESS)
        notice = Notice("错误", NoticeTone.ERROR, "details")
        replaced = reducers.notice_raised(raised, notice)
        self.assertIs(replaced.notice, notice)
        dismissed = reducers.notice_dismissed(replaced)
        self.assertIsNone(dismissed.notice)
        self.assert_valid(before, raised, replaced, dismissed)

    def test_notice_defaults_to_toast(self) -> None:
        notice = Notice("完成")
        self.assertEqual(notice.title, "")
        self.assertFalse(notice.dialog)
        state = reducers.notice_raised(base(), notice)
        self.assertIs(state.notice, notice)
        self.assertEqual(state.notice.title, "")
        self.assertFalse(state.notice.dialog)

    def test_notice_preserves_title_and_dialog(self) -> None:
        notice = Notice(
            "保存失败",
            NoticeTone.ERROR,
            "raw output",
            title="无法保存设置",
            dialog=True,
        )
        state = reducers.notice_raised(base(), notice)
        self.assertIs(state.notice, notice)
        self.assertEqual(state.notice.title, "无法保存设置")
        self.assertTrue(state.notice.dialog)
        self.assertEqual(state.notice.text, "保存失败")
        self.assertEqual(state.notice.details, "raw output")


class ForegroundTest(ReducerInvariantMixin):
    def test_foreground_lifecycle(self) -> None:
        before = base()
        session = ForegroundSession(target_key=before.target.key)
        started = reducers.foreground_updated(before, session)
        self.assertIs(started.foreground, session)
        running = reducers.foreground_updated(
            started,
            session.with_phase(
                ForegroundPhase.RUNNING,
                address="127.0.0.1:8090",
                url="http://127.0.0.1:8090",
            ),
        )
        self.assertIs(running.foreground.phase, ForegroundPhase.RUNNING)
        self.assertEqual(running.foreground.url, "http://127.0.0.1:8090")
        cleared = reducers.foreground_updated(running, None)
        self.assertIsNone(cleared.foreground)
        self.assert_valid(before, started, running, cleared)

    def test_foreground_wrong_target(self) -> None:
        with self.assertRaises(ValueError):
            reducers.foreground_updated(
                base(), ForegroundSession(target_key="other")
            )

    def test_foreground_tail_is_trimmed(self) -> None:
        before = base()
        session = ForegroundSession(target_key=before.target.key)
        long = ForegroundSession(
            target_key=before.target.key,
            tail=tuple(str(index) for index in range(50)),
        )
        after = reducers.foreground_updated(before, long)
        self.assertEqual(len(after.foreground.tail), 40)
        self.assertEqual(after.foreground.tail[0], "10")
        self.assert_valid(after)


class ClosingFreezeTest(ReducerInvariantMixin):
    def test_io_results_are_dropped_after_closing(self) -> None:
        before = reducers.closing_started(logged_in())
        key = before.target.key
        cases = [
            reducers.facts_loaded(before, host(key)),
            reducers.facts_failed(before, "late"),
            reducers.identity_loaded(before, identity("late")),
            reducers.users_loaded(before, (user("late"),)),
            reducers.backups_loaded(before, (backup("late.zip"),)),
            reducers.foreground_updated(
                before, ForegroundSession(target_key=key)
            ),
            reducers.notice_raised(before, "late"),
            reducers.task_started(before, TaskKey.INFO),
            reducers.set_page(before, PageId.SETTINGS),
            reducers.target_changed(before, target(remote=True)),
            reducers.select_backup(before, None),
        ]
        for after in cases:
            self.assertIs(after, before)
            self.assert_valid(after)

    def test_auth_expired_is_dropped_after_closing(self) -> None:
        before = reducers.closing_started(logged_in())
        self.assertIs(reducers.auth_expired(before), before)
        self.assertIs(reducers.login_prompt_set(before, LoginPrompt("x")), before)


if __name__ == "__main__":
    unittest.main()
