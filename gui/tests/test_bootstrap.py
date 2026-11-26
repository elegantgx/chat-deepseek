"""bootstrap 装配测试：v3 配置、模板回退、损坏路径兜底与 fake 通道。

全部用临时 `XDG_CONFIG_HOME`，并注入 FakeTransport；不启动真实 CLI 或 ssh。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtWidgets import QApplication

import gui_config
import server_config
import theme
from cdgui import bootstrap
from cdgui.domain.state import TaskKey
from cdgui.domain.target import ConnectionKind
from cdgui.infra import process as process_module
from cdgui.infra.process import CommandResult
from cdgui.ui.main_window import MainWindow

INFO_TEXT = "\n".join(
    (
        "version=0.1.4-official0.1.4",
        "os=linux",
        "arch=amd64",
        "binary=/opt/chat-deepseek/chat-deepseek",
        "data_dir=/opt/chat-deepseek/data",
        "initialized=true",
        "listen=127.0.0.1:8090",
        "public_url=",
        "api_origin=https://api.deepseek.com",
        "backup_dir=/opt/chat-deepseek/data/backups",
        "service_supported=false",
        "service_scope=",
        "service_installed=false",
        "service_active=false",
        "service_enabled=false",
        "service_unit=",
        "service_linger=false",
    )
)


class FakeTransport:
    """记录调用并返回固定 info；控制器关闭时只做标记。"""

    def __init__(self, target) -> None:
        self.target = target
        self.calls: list[tuple[str, ...]] = []
        self.closed = False

    def run(self, spec, cancel=None) -> CommandResult:
        self.calls.append(tuple(spec.argv))
        return CommandResult(tuple(spec.argv), 0, INFO_TEXT, "")

    def open_serve(self, spec, *, on_line=None, on_exit=None):  # pragma: no cover
        raise AssertionError("bootstrap 测试不应启动前台服务")

    def verify(self, timeout: float = 20.0) -> None:
        return None

    def close(self) -> None:
        self.closed = True


class BootstrapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])
        # 避免每次建控件都去问 gsettings（GNOME 下每次约 5ms × 数百次）。
        cls._dark_hint = theme._dark_hint
        theme._dark_hint = False

    @classmethod
    def tearDownClass(cls) -> None:
        theme._dark_hint = cls._dark_hint

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        env_patch = mock.patch.dict(
            os.environ, {"XDG_CONFIG_HOME": str(self.root)}, clear=False
        )
        env_patch.start()
        self.addCleanup(env_patch.stop)
        self.config_path = self.root / "chat-deepseek" / "config.gui.json"
        self.config_path.parent.mkdir(parents=True)
        # 默认的 find_binary 指向真实仓库；测试里固定成一个临时可执行文件。
        self.binary = self._write_binary(self.root / "app")
        find_patch = mock.patch.object(
            bootstrap, "find_binary", return_value=str(self.binary)
        )
        find_patch.start()
        self.addCleanup(find_patch.stop)

    # ---- fixture ---------------------------------------------------------

    def _write_binary(self, directory: Path) -> Path:
        directory.mkdir(parents=True, exist_ok=True)
        binary = directory / process_module.binary_name()
        binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        binary.chmod(0o755)
        return binary

    def _write_config(self, payload: dict) -> None:
        self.config_path.write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )

    def _build(self) -> tuple[MainWindow, object]:
        window, controller = bootstrap.build_application(
            transport_factory=FakeTransport
        )
        self.addCleanup(window.close)
        return window, controller

    def _v3(self, *, connection: str = "local", **sections) -> dict:
        data_dir = self.root / "data"
        local = sections.pop(
            "local",
            {"binary_dir": str(self.binary.parent), "data_dir": str(data_dir), "username": ""},
        )
        ssh = sections.pop(
            "ssh", {"host": "", "binary_dir": "", "data_dir": "", "username": ""}
        )
        return {
            "version": 3,
            "connection": connection,
            "local": local,
            "ssh": ssh,
            **sections,
        }

    # ---- 用例 ------------------------------------------------------------

    def test_v3_config_resolves_local_target(self) -> None:
        data_dir = self.root / "data"
        self._write_config(self._v3())

        window, controller = self._build()

        self.assertIsInstance(window, MainWindow)
        self.assertIs(window.controller, controller)
        target = controller.state.target
        self.assertIs(target.connection, ConnectionKind.LOCAL)
        self.assertEqual(target.binary, str(self.binary.resolve()))
        self.assertEqual(target.data_dir, str(data_dir))
        self.assertFalse(target.remote)

    def test_empty_config_falls_back_to_find_binary_defaults(self) -> None:
        window, controller = self._build()

        self.assertIsInstance(window, MainWindow)
        target = controller.state.target
        self.assertEqual(target.binary, str(self.binary.resolve()))
        self.assertEqual(
            target.data_dir,
            str(server_config.default_data_dir(self.binary.parent)),
        )
        self.assertEqual(target.endpoint.binary_dir, str(self.binary.parent))
        # 空配置不算迁移，不应凭空写出配置文件。
        self.assertFalse(self.config_path.exists())

    def test_seed_template_is_used_when_config_is_empty(self) -> None:
        seed = self.root / "seed" / "config.gui.json"
        seed.parent.mkdir(parents=True)
        seed.write_text(
            json.dumps(self._v3()), encoding="utf-8"
        )
        with mock.patch.object(gui_config, "seed_paths", return_value=[seed]):
            _window, controller = self._build()

        self.assertEqual(
            controller.state.target.binary, str(self.binary.resolve())
        )
        # 模板只在内存里生效；空的默认路径不会被模板内容覆盖写入。
        self.assertFalse(self.config_path.exists())

    def test_broken_binary_dir_still_builds_window(self) -> None:
        self._write_config(
            self._v3(
                local={
                    "binary_dir": str(self.root / "missing"),
                    "data_dir": "",
                    "username": "",
                }
            )
        )

        window, controller = self._build()

        self.assertIsInstance(window, MainWindow)
        target = controller.state.target
        self.assertEqual(target.binary, str(self.binary.resolve()))
        self.assertEqual(
            target.data_dir,
            str(server_config.default_data_dir(self.binary.parent)),
        )
        # 原始配置保留，设置页可以打开让用户改回来。
        self.assertEqual(
            controller.config.local.binary_dir, str(self.root / "missing")
        )

    def test_broken_binary_dir_keeps_configured_data_dir(self) -> None:
        self._write_config(
            self._v3(
                local={
                    "binary_dir": str(self.root / "missing"),
                    "data_dir": "/tmp/custom",
                    "username": "",
                }
            )
        )

        _window, controller = self._build()

        target = controller.state.target
        self.assertEqual(target.data_dir, "/tmp/custom")
        self.assertEqual(target.binary, str(self.binary.resolve()))

    def test_remote_without_binary_dir_falls_back_to_best_effort(self) -> None:
        self._write_config(
            self._v3(
                connection="ssh",
                ssh={"host": "nas", "binary_dir": "", "data_dir": "", "username": ""},
            )
        )

        window, controller = self._build()

        self.assertIsInstance(window, MainWindow)
        target = controller.state.target
        self.assertTrue(target.remote)
        self.assertEqual(target.host, "nas")
        self.assertEqual(target.binary, "chat-deepseek")
        self.assertEqual(target.data_dir, "")

    def test_invalid_connection_falls_back_to_local(self) -> None:
        self._write_config(self._v3(connection="carrier-pigeon"))

        _window, controller = self._build()

        self.assertIs(controller.state.target.connection, ConnectionKind.LOCAL)
        self.assertEqual(controller.config.connection, "local")

    def test_v1_config_is_migrated_and_saved(self) -> None:
        local_dir = self.root / "legacy"
        self._write_config(
            {
                "version": 1,
                "binary": str(local_dir),
                "data_dir": str(self.root / "legacy-data"),
                "backup_dir": str(self.root / "legacy-backups"),
                "username": "alice",
            }
        )

        _window, controller = self._build()

        saved = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["version"], 3)
        self.assertEqual(saved["connection"], "local")
        self.assertEqual(saved["local"]["binary_dir"], str(local_dir))
        self.assertEqual(saved["local"]["username"], "alice")
        self.assertNotIn("backup_dir", saved)
        self.assertNotIn("binary", saved)
        # 旧备份地址仍交给 controller 迁移，不丢。
        self.assertEqual(
            controller.config.legacy_backup_dir, str(self.root / "legacy-backups")
        )

    def test_bootstrap_queues_info_without_draining(self) -> None:
        self._write_config(self._v3())

        _window, controller = self._build()

        self.assertIn(TaskKey.INFO, controller.state.inflight)
        self.assertEqual(controller.state.phase.value, "booting")

    def test_transport_factory_receives_startup_target(self) -> None:
        self._write_config(self._v3())
        targets: list[object] = []

        def factory(target):
            targets.append(target)
            return FakeTransport(target)

        window, controller = bootstrap.build_application(
            transport_factory=factory
        )
        self.addCleanup(window.close)

        self.assertEqual(len(targets), 1)
        self.assertIs(targets[0], controller.state.target)
        self.assertIsInstance(controller._transport, FakeTransport)


if __name__ == "__main__":
    unittest.main()
