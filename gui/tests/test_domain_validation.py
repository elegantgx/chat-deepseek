from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cdgui.domain import validation


class PasswordTest(unittest.TestCase):
    def test_length_boundaries(self) -> None:
        self.assertNotEqual(validation.password_error("1234567"), "")
        self.assertEqual(validation.password_error("12345678"), "")
        self.assertEqual(validation.password_error("x" * 1024), "")
        self.assertNotEqual(validation.password_error("x" * 1025), "")
        self.assertEqual(
            validation.password_error("x" * 7),
            "密码长度需在 8–1024 位之间",
        )

    def test_confirm(self) -> None:
        self.assertEqual(validation.password_confirm_error("12345678", "12345678"), "")
        self.assertEqual(
            validation.password_confirm_error("12345678", "12345679"),
            "两次输入的密码不一致",
        )
        # 长度错误优先于“不一致”。
        self.assertEqual(
            validation.password_confirm_error("short", "other"),
            "密码长度需在 8–1024 位之间",
        )

    def test_login_password(self) -> None:
        self.assertEqual(validation.login_password_error(""), "请输入密码")
        self.assertEqual(validation.login_password_error("x"), "")


class UrlTest(unittest.TestCase):
    def test_http_url(self) -> None:
        for value in (
            "http://localhost:8090",
            "https://chat.example.com/path",
            "http://127.0.0.1",
        ):
            self.assertTrue(validation.is_http_url(value), value)
        for value in (
            "",
            "chat.example.com",
            "ftp://chat.example.com",
            "http://",
            "https:///path",
            "not a url",
        ):
            self.assertFalse(validation.is_http_url(value), value)

    def test_messages(self) -> None:
        self.assertEqual(validation.public_url_error(""), "")
        self.assertEqual(
            validation.public_url_error("chat.example.com"),
            "Public URL 必须以 http:// 或 https:// 开头",
        )
        self.assertEqual(
            validation.api_origin_error("ftp://x"),
            "API 地址必须以 http:// 或 https:// 开头",
        )
        self.assertEqual(
            validation.url_error("", "地址", required=True), "地址不能为空"
        )


class PathTest(unittest.TestCase):
    def test_remote_binary_dir(self) -> None:
        self.assertEqual(
            validation.remote_binary_dir_error(""), "请填写远端二进制目录"
        )
        self.assertEqual(
            validation.remote_binary_dir_error("opt/chat-deepseek"),
            "远端二进制目录必须是绝对路径",
        )
        self.assertEqual(
            validation.remote_binary_dir_error("/opt/chat-deepseek"), ""
        )

    def test_remote_data_dir(self) -> None:
        self.assertEqual(validation.remote_data_dir_error(""), "")
        self.assertEqual(
            validation.remote_data_dir_error("data"),
            "远端数据目录必须是绝对路径，留空使用远端默认值",
        )
        self.assertEqual(validation.remote_data_dir_error("/srv/data"), "")
        # 远端不展开 ~
        self.assertNotEqual(validation.remote_data_dir_error("~/data"), "")

    def test_backup_dir(self) -> None:
        self.assertEqual(validation.backup_dir_error("", remote=False), "")
        self.assertEqual(validation.backup_dir_error("", remote=True), "")
        self.assertNotEqual(
            validation.backup_dir_error("backups", remote=False), ""
        )
        self.assertNotEqual(
            validation.backup_dir_error("backups", remote=True), ""
        )
        self.assertEqual(
            validation.backup_dir_error("/srv/data/backups", remote=True), ""
        )
        # 本机接受 ~ 开头的绝对路径；远端不接受。
        self.assertEqual(
            validation.backup_dir_error("~/backups", remote=False), ""
        )
        self.assertNotEqual(
            validation.backup_dir_error("~/backups", remote=True), ""
        )

    def test_required_fields(self) -> None:
        self.assertEqual(
            validation.local_binary_dir_error(""), "请选择二进制目录"
        )
        self.assertEqual(validation.local_data_dir_error(""), "数据目录不能为空")
        self.assertEqual(validation.host_error(""), "请填写 SSH 主机")
        self.assertEqual(validation.listen_error(""), "监听地址不能为空")
        self.assertEqual(validation.listen_error("127.0.0.1:8090"), "")

    def test_is_absolute_path(self) -> None:
        self.assertTrue(validation.is_absolute_path("/a", remote=True))
        self.assertFalse(validation.is_absolute_path("a", remote=True))
        self.assertTrue(validation.is_absolute_path("~/a", remote=False))
        self.assertFalse(validation.is_absolute_path("a", remote=False))
        self.assertFalse(validation.is_absolute_path("", remote=False))


if __name__ == "__main__":
    unittest.main()
