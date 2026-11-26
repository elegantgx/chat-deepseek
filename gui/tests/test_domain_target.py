from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.domain import target as target_module
from cdgui.domain.target import (
    Capability,
    ConnectionKind,
    Endpoint,
    Target,
    TargetError,
    resolve_target,
    with_data_dir,
)


def _local_binary(directory: Path) -> Path:
    path = directory / target_module.binary_name()
    path.write_text("", encoding="utf-8")
    return path


class ResolveLocalTargetTest(unittest.TestCase):
    def test_accepts_directory_and_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            binary = _local_binary(root)
            data = root / "data"
            from_dir = resolve_target(
                Endpoint(
                    kind=ConnectionKind.LOCAL,
                    binary_dir=str(root),
                    data_dir=str(data),
                )
            )
            from_file = resolve_target(
                Endpoint(
                    kind=ConnectionKind.LOCAL,
                    binary_dir=str(binary),
                    data_dir=str(data),
                )
            )
            self.assertEqual(from_dir.binary, str(binary.resolve()))
            self.assertEqual(from_file.binary, str(binary.resolve()))
            self.assertEqual(from_dir.key, from_file.key)
            self.assertEqual(from_dir.data_dir, str(data))
            self.assertFalse(from_dir.remote)
            self.assertEqual(from_dir.endpoint.host, "")

    def test_missing_binary_is_user_message(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(TargetError) as caught:
                resolve_target(
                    Endpoint(
                        kind=ConnectionKind.LOCAL,
                        binary_dir=temp,
                        data_dir=temp,
                    )
                )
            self.assertIn("目录里没有", str(caught.exception))

    def test_empty_paths(self) -> None:
        with self.assertRaisesRegex(TargetError, "请选择 chat-deepseek"):
            resolve_target(Endpoint(kind=ConnectionKind.LOCAL, binary_dir=""))
        with tempfile.TemporaryDirectory() as temp:
            _local_binary(Path(temp))
            with self.assertRaisesRegex(TargetError, "数据目录不能为空"):
                resolve_target(
                    Endpoint(kind=ConnectionKind.LOCAL, binary_dir=temp)
                )


class ResolveRemoteTargetTest(unittest.TestCase):
    def test_remote_keeps_paths_and_key(self) -> None:
        resolved = resolve_target(
            Endpoint(
                kind=ConnectionKind.SSH,
                host="nas",
                binary_dir="/opt/chat-deepseek",
                data_dir="/srv/cd-data",
            )
        )
        self.assertTrue(resolved.remote)
        self.assertEqual(resolved.binary, "/opt/chat-deepseek/chat-deepseek")
        self.assertEqual(resolved.data_dir, "/srv/cd-data")
        self.assertEqual(
            resolved.key,
            "ssh|nas|/opt/chat-deepseek/chat-deepseek|/srv/cd-data",
        )

    def test_remote_empty_data_dir_is_allowed(self) -> None:
        resolved = resolve_target(
            Endpoint(kind=ConnectionKind.SSH, host="nas", binary_dir="/opt")
        )
        self.assertEqual(resolved.data_dir, "")
        self.assertEqual(resolved.binary, "/opt/chat-deepseek")

    def test_remote_data_dir_not_expanded(self) -> None:
        # 远端路径原样交给 CLI，不做 ~ 展开，也不接受非绝对路径。
        with self.assertRaisesRegex(TargetError, "绝对路径"):
            resolve_target(
                Endpoint(
                    kind=ConnectionKind.SSH,
                    host="nas",
                    binary_dir="/opt",
                    data_dir="~/data",
                )
            )

    def test_remote_validation_messages(self) -> None:
        cases = [
            (
                Endpoint(kind=ConnectionKind.SSH, binary_dir="/opt"),
                "请填写 SSH 主机",
            ),
            (
                Endpoint(kind=ConnectionKind.SSH, host="nas"),
                "请填写远端二进制目录",
            ),
            (
                Endpoint(
                    kind=ConnectionKind.SSH, host="nas", binary_dir="opt"
                ),
                "远端二进制目录必须是绝对路径",
            ),
            (
                Endpoint(
                    kind=ConnectionKind.SSH,
                    host="nas",
                    binary_dir="/opt",
                    data_dir="data",
                ),
                "远端数据目录必须是绝对路径",
            ),
        ]
        for endpoint, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(TargetError, message):
                    resolve_target(endpoint)


class CapabilityAndKeyTest(unittest.TestCase):
    def _local(self) -> Target:
        return Target(
            endpoint=Endpoint(
                kind=ConnectionKind.LOCAL, binary_dir="/opt", data_dir="/d"
            ),
            binary="/opt/chat-deepseek",
            data_dir="/d",
        )

    def _remote(self) -> Target:
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

    def test_remote_capabilities(self) -> None:
        remote = self._remote()
        self.assertTrue(remote.supports(Capability.FOREGROUND_SERVE))
        self.assertTrue(remote.supports(Capability.OPEN_PAGE))
        self.assertFalse(remote.supports(Capability.SAVE_BACKUP_AS))
        self.assertFalse(remote.supports(Capability.PICK_LOCAL_PATH))
        with self.assertRaises(ValueError):
            remote.supports("unknown")  # type: ignore[arg-type]

    def test_local_capabilities(self) -> None:
        local = self._local()
        for capability in Capability:
            self.assertTrue(local.supports(capability))

    def test_key_includes_every_component(self) -> None:
        base = self._remote()
        self.assertIn("ssh", base.key)
        self.assertIn("nas", base.key)
        self.assertIn("/opt/chat-deepseek", base.key)
        changed = with_data_dir(base, "/data")
        self.assertNotEqual(base.key, changed.key)
        self.assertIn("/data", changed.key)

    def test_remote_binary_root(self) -> None:
        self.assertEqual(target_module.remote_binary("/"), "/chat-deepseek")


if __name__ == "__main__":
    unittest.main()
