from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import parsing

from cdgui.domain.facts import ForegroundPhase, ForegroundSession, HostConfig, ServiceStatus
from cdgui.domain.state import (
    AppState,
    InflightEntry,
    InvariantError,
    Phase,
    TaskKey,
    assert_invariants,
)
from cdgui.domain.target import ConnectionKind, Endpoint, Target


def target() -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL, binary_dir="/opt", data_dir="/d"
        ),
        binary="/opt/chat-deepseek",
        data_dir="/d",
    )


def host(
    key: str,
    *,
    initialized: bool = True,
    service: ServiceStatus | None = None,
    public_url: str = "",
    data_dir: str = "/d",
) -> HostConfig:
    return HostConfig(
        target_key=key,
        version="0.1.4",
        os="linux",
        arch="amd64",
        initialized=initialized,
        listen="127.0.0.1:8090",
        public_url=public_url,
        api_origin="https://api.deepseek.com",
        backup_dir="/d/backups",
        service=service or ServiceStatus(supported=True),
        data_dir=data_dir,
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


class ValidStateTest(unittest.TestCase):
    def test_initial_state(self) -> None:
        state = AppState(target=target())
        assert_invariants(state)
        self.assertEqual(state.page.value, "service")
        self.assertIs(state.phase, Phase.BOOTING)
        self.assertFalse(state.closing)
        self.assertEqual(dict(state.hosts), {})
        self.assertEqual(dict(state.inflight), {})

    def test_full_logged_in_state(self) -> None:
        state = AppState(
            target=target(),
            hosts={target().key: host(target().key)},
            identity=identity(groups=("User", "Owner")),
            users=(user(),),
            backups=(parsing.Backup("a.zip", "1.0 MB", datetime(2026, 11, 26)),),
            selected="alice",
            foreground=ForegroundSession(
                target_key=target().key,
                phase=ForegroundPhase.RUNNING,
                url="http://127.0.0.1:8090",
            ),
            inflight={
                TaskKey.USERS: InflightEntry(
                    TaskKey.USERS, target().key, generation=2
                )
            },
        )
        assert_invariants(state)

    def test_selected_backup_must_exist(self) -> None:
        state = AppState(
            target=target(),
            identity=identity(groups=("User", "Owner")),
            users=(user(),),
            backups=(
                parsing.Backup("a.zip", "1 MB", datetime(2026, 11, 26)),
            ),
            selected_backup="a.zip",
        )
        assert_invariants(state)

    def test_containers_are_read_only(self) -> None:
        state = AppState(target=target(), hosts={target().key: host(target().key)})
        with self.assertRaises(TypeError):
            state.hosts["x"] = host(target().key)  # type: ignore[index]


class BrokenStateTest(unittest.TestCase):
    def test_host_key_mismatch(self) -> None:
        key = target().key
        state = AppState(target=target(), hosts={key: host("other")})
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_stale_host_for_other_target(self) -> None:
        key = target().key
        stale = HostConfig(
            target_key="old",
            version="1",
            os="linux",
            arch="amd64",
            initialized=True,
            listen="",
            public_url="",
            api_origin="",
            backup_dir="",
            service=ServiceStatus(),
        )
        state = AppState(target=target(), hosts={"old": stale})
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_active_without_installed(self) -> None:
        key = target().key
        service = ServiceStatus(supported=True, installed=False, active=True)
        state = AppState(target=target(), hosts={key: host(key, service=service)})
        with self.assertRaisesRegex(InvariantError, "active ⇒ installed"):
            assert_invariants(state)

    def test_users_without_identity(self) -> None:
        state = AppState(target=target(), users=(user(),))
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_selected_not_in_users(self) -> None:
        state = AppState(
            target=target(),
            identity=identity(),
            users=(user("bob"),),
            selected="alice",
        )
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_selected_without_identity(self) -> None:
        state = AppState(target=target(), selected="alice")
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_foreground_target_mismatch(self) -> None:
        state = AppState(
            target=target(),
            foreground=ForegroundSession(target_key="other"),
        )
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_foreground_tail_too_long(self) -> None:
        state = AppState(
            target=target(),
            foreground=ForegroundSession(
                target_key=target().key, tail=tuple("x" for _ in range(41))
            ),
        )
        with self.assertRaisesRegex(InvariantError, "40"):
            assert_invariants(state)

    def test_inflight_generation(self) -> None:
        entry = InflightEntry(TaskKey.INFO, target().key, generation=0)
        state = AppState(target=target(), inflight={TaskKey.INFO: entry})
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_inflight_target_mismatch(self) -> None:
        entry = InflightEntry(TaskKey.INFO, "other", generation=1)
        state = AppState(target=target(), inflight={TaskKey.INFO: entry})
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_selected_backup_without_identity(self) -> None:
        state = AppState(target=target(), selected_backup="a.zip")
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_selected_backup_without_backups(self) -> None:
        state = AppState(
            target=target(),
            identity=identity(),
            users=(user(),),
            selected_backup="a.zip",
        )
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_selected_backup_not_in_list(self) -> None:
        state = AppState(
            target=target(),
            identity=identity(groups=("User", "Owner")),
            users=(user(),),
            backups=(
                parsing.Backup("a.zip", "1 MB", datetime(2026, 11, 26)),
            ),
            selected_backup="missing.zip",
        )
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_host_data_dir_required(self) -> None:
        key = target().key
        state = AppState(
            target=target(), hosts={key: host(key, data_dir="")}
        )
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_host_data_dir_must_match_target(self) -> None:
        key = target().key
        state = AppState(
            target=target(), hosts={key: host(key, data_dir="/other")}
        )
        with self.assertRaises(InvariantError):
            assert_invariants(state)

    def test_remote_empty_target_uses_info_data_dir(self) -> None:
        remote = Target(
            endpoint=Endpoint(
                kind=ConnectionKind.SSH,
                host="nas",
                binary_dir="/opt",
                data_dir="",
            ),
            binary="/opt/chat-deepseek",
            data_dir="",
        )
        state = AppState(
            target=remote, hosts={remote.key: host(remote.key, data_dir="/srv/data")}
        )
        assert_invariants(state)

    def test_closing_phase_consistency(self) -> None:
        state = AppState(target=target(), closing=True)
        with self.assertRaises(InvariantError):
            assert_invariants(state)
        state = AppState(target=target(), phase=Phase.CLOSING)
        with self.assertRaises(InvariantError):
            assert_invariants(state)
        assert_invariants(
            AppState(target=target(), phase=Phase.CLOSING, closing=True)
        )


if __name__ == "__main__":
    unittest.main()
