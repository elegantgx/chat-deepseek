"""infra.persistence：GuiConfigRepository 的读写与失败传播。"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import gui_config
from cdgui.infra.persistence import GuiConfigRepository


class RepositoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "config.gui.json"

    def test_missing_file_loads_empty_config(self) -> None:
        repository = GuiConfigRepository(self.path)
        config = repository.load()
        self.assertTrue(config.empty)
        self.assertEqual(config.version, gui_config.SCHEMA_VERSION)

    def test_save_then_load_roundtrip(self) -> None:
        repository = GuiConfigRepository(self.path)
        config = gui_config.Config(
            connection="ssh",
            local=gui_config.LocalConfig(
                binary_dir="/opt/local", data_dir="/srv/local", username="me"
            ),
            ssh=gui_config.SshConfig(
                host="nas",
                binary_dir="/volume1/app",
                data_dir="/volume1/data",
                username="remote",
            ),
        )
        repository.save(config)
        self.assertTrue(self.path.is_file())
        loaded = repository.load()
        self.assertEqual(loaded.connection, "ssh")
        self.assertEqual(loaded.local.binary_dir, "/opt/local")
        self.assertEqual(loaded.ssh.host, "nas")
        self.assertEqual(loaded.ssh.username, "remote")

    def test_save_failure_propagates_oserror(self) -> None:
        # 让目标路径本身是一个目录：os.replace 会失败，异常不能在这里被吞。
        directory = Path(self.temp.name) / "as-directory"
        directory.mkdir()
        repository = GuiConfigRepository(directory)
        with self.assertRaises(OSError):
            repository.save(gui_config.Config())

    def test_default_path_uses_platform_config_dir(self) -> None:
        with mock.patch.dict(os.environ, {"XDG_CONFIG_HOME": self.temp.name}):
            repository = GuiConfigRepository()
        self.assertEqual(
            repository.path,
            Path(self.temp.name) / "chat-deepseek" / "config.gui.json",
        )


if __name__ == "__main__":
    unittest.main()
