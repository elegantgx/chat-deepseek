from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import parsing

from cdgui.domain.facts import (
    ForegroundPhase,
    ForegroundSession,
    HostConfig,
    ServiceStatus,
)
from cdgui.domain.state import AppState, assert_invariants
from cdgui.domain.target import ConnectionKind, Endpoint, Target


def info(**overrides: object) -> parsing.Info:
    values: dict[str, object] = {
        "version": "0.1.4",
        "os": "linux",
        "arch": "amd64",
        "binary": "/opt/chat-deepseek",
        "data_dir": "/srv/data",
        "initialized": True,
        "listen": "127.0.0.1:8090",
        "public_url": "",
        "api_origin": "https://api.deepseek.com",
        "backup_dir": "/srv/data/backups",
        "service_supported": True,
        "service_scope": "user",
        "service_installed": False,
        "service_active": False,
        "service_enabled": False,
        "service_unit": "",
        "service_linger": False,
    }
    values.update(overrides)
    return parsing.Info(**values)  # type: ignore[arg-type]


class ServiceStatusTest(unittest.TestCase):
    def test_from_info_maps_every_flag(self) -> None:
        status = ServiceStatus.from_info(
            info(
                service_supported=True,
                service_installed=True,
                service_active=True,
                service_enabled=True,
                service_linger=True,
                service_scope="user",
                service_unit="/home/me/.config/systemd/user/x.service",
            )
        )
        self.assertTrue(status.supported)
        self.assertTrue(status.installed)
        self.assertTrue(status.active)
        self.assertTrue(status.enabled)
        self.assertTrue(status.linger)
        self.assertEqual(status.scope, "user")
        self.assertEqual(
            status.unit, "/home/me/.config/systemd/user/x.service"
        )

    def test_from_info_keeps_inconsistent_active(self) -> None:
        # 不在 from_info 里偷偷纠正：active 但未安装要由 assert_invariants 发现。
        status = ServiceStatus.from_info(info(service_active=True))
        self.assertTrue(status.active)
        self.assertFalse(status.installed)


class HostConfigTest(unittest.TestCase):
    def test_from_info_sets_target_key_and_data_dir(self) -> None:
        host = HostConfig.from_info("ssh|nas|/opt/chat-deepseek|", info())
        self.assertEqual(host.target_key, "ssh|nas|/opt/chat-deepseek|")
        self.assertEqual(host.data_dir, "/srv/data")
        self.assertEqual(host.listen, "127.0.0.1:8090")
        self.assertEqual(host.backup_dir, "/srv/data/backups")
        self.assertEqual(host.service.installed, False)

    def test_empty_target_key_rejected(self) -> None:
        with self.assertRaises(ValueError):
            HostConfig.from_info("", info())


class ForegroundSessionTest(unittest.TestCase):
    def test_tail_keeps_last_40_lines(self) -> None:
        session = ForegroundSession(target_key="k")
        tailed = session.with_tail(tuple(f"line-{index}" for index in range(50)))
        self.assertEqual(len(tailed.tail), 40)
        self.assertEqual(tailed.tail[0], "line-10")
        self.assertEqual(tailed.tail[-1], "line-49")

    def test_with_phase_replaces_only_given_fields(self) -> None:
        session = ForegroundSession(
            target_key="k", address="127.0.0.1:8090", url="http://x"
        )
        running = session.with_phase(ForegroundPhase.RUNNING)
        self.assertEqual(running.phase, ForegroundPhase.RUNNING)
        self.assertEqual(running.address, "127.0.0.1:8090")
        self.assertEqual(running.url, "http://x")
        self.assertEqual(running.with_phase(ForegroundPhase.STOPPING).url, "http://x")

    def test_state_accepts_foreground(self) -> None:
        target = Target(
            endpoint=Endpoint(
                kind=ConnectionKind.LOCAL, binary_dir="/opt", data_dir="/d"
            ),
            binary="/opt/chat-deepseek",
            data_dir="/d",
        )
        state = AppState(
            target=target,
            foreground=ForegroundSession(
                target_key=target.key,
                phase=ForegroundPhase.RUNNING,
                url="http://127.0.0.1:8090",
            ),
        )
        assert_invariants(state)


if __name__ == "__main__":
    unittest.main()
