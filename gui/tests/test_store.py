"""Store：单一状态容器、不变量校验与订阅。"""

from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.domain.facts import HostConfig, ServiceStatus
from cdgui.domain.state import (
    AppState,
    InvariantError,
    PageId,
    Phase,
)
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.store import Store


def target(data_dir: str = "/data") -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL,
            binary_dir="/opt",
            data_dir=data_dir,
        ),
        binary="/opt/chat-deepseek",
        data_dir=data_dir,
    )


def host(target_key: str, *, data_dir: str = "/data") -> HostConfig:
    return HostConfig(
        target_key=target_key,
        version="0.1.4",
        os="linux",
        arch="amd64",
        initialized=True,
        listen="127.0.0.1:8090",
        public_url="",
        api_origin="https://api.deepseek.com",
        backup_dir="/data/backups",
        service=ServiceStatus(),
        data_dir=data_dir,
    )


class StoreTest(unittest.TestCase):
    def test_holds_initial_state(self) -> None:
        state = AppState(target=target())
        store = Store(state)
        self.assertIs(store.state, state)

    def test_update_replaces_state_and_notifies(self) -> None:
        store = Store(AppState(target=target()))
        seen: list[AppState] = []
        store.subscribe(seen.append)

        def reducer(state: AppState) -> AppState:
            self.assertEqual(state.phase, Phase.BOOTING)
            return replace(state, phase=Phase.READY)

        store.update(reducer)
        self.assertEqual(store.state.phase, Phase.READY)
        self.assertEqual(len(seen), 1)
        self.assertIs(seen[0], store.state)

    def test_update_chains_from_previous_state(self) -> None:
        store = Store(AppState(target=target()))
        store.update(lambda state: replace(state, page=PageId.ACCOUNTS))
        store.update(lambda state: replace(state, page=PageId.BACKUPS))
        self.assertIs(store.state.page, PageId.BACKUPS)

    def test_listener_unsubscribe_is_idempotent(self) -> None:
        store = Store(AppState(target=target()))
        seen: list[AppState] = []
        unsubscribe = store.subscribe(seen.append)
        store.update(lambda state: replace(state, page=PageId.SETTINGS))
        self.assertEqual(len(seen), 1)
        unsubscribe()
        unsubscribe()
        store.update(lambda state: replace(state, page=PageId.SERVICE))
        self.assertEqual(len(seen), 1)

    def test_multiple_listeners_receive_in_order(self) -> None:
        store = Store(AppState(target=target()))
        order: list[str] = []
        store.subscribe(lambda _state: order.append("first"))
        store.subscribe(lambda _state: order.append("second"))
        store.update(lambda state: replace(state, page=PageId.BACKUPS))
        self.assertEqual(order, ["first", "second"])

    def test_unsubscribe_during_notification_is_safe(self) -> None:
        store = Store(AppState(target=target()))
        seen: list[str] = []

        def once(_state: AppState) -> None:
            seen.append("once")
            unsubscribe()

        unsubscribe = store.subscribe(once)
        store.subscribe(lambda _state: seen.append("always"))
        store.update(lambda state: replace(state, page=PageId.BACKUPS))
        store.update(lambda state: replace(state, page=PageId.SERVICE))
        self.assertEqual(seen, ["once", "always", "always"])

    def test_invariant_failure_keeps_old_state_and_skips_notice(self) -> None:
        state = AppState(target=target())
        store = Store(state)
        seen: list[AppState] = []
        store.subscribe(seen.append)

        def invalid(current: AppState) -> AppState:
            # hosts 里放一个非当前目标，直接违反不变量。
            return replace(current, hosts={"other": host("other")})

        with self.assertRaises(InvariantError):
            store.update(invalid)
        self.assertIs(store.state, state)
        self.assertEqual(seen, [])

    def test_store_rejects_invalid_initial_state(self) -> None:
        invalid = AppState(target=target(), hosts={"other": host("other")})
        with self.assertRaises(InvariantError):
            Store(invalid)

    def test_update_can_return_same_state(self) -> None:
        store = Store(AppState(target=target()))
        seen: list[AppState] = []
        store.subscribe(seen.append)
        store.update(lambda state: state)
        # 约定是每次 update 都通知；调用方用 selector 决定是否重绘。
        self.assertEqual(len(seen), 1)
        self.assertIs(seen[0], store.state)


if __name__ == "__main__":
    unittest.main()
