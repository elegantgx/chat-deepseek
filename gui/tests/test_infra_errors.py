"""infra.errors：退出码与坏输出的归一化。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import parsing
from cdgui.domain.target import ConnectionKind, Endpoint, Target
from cdgui.infra import errors
from cdgui.infra.process import CANCELLED_STDERR, TIMEOUT_STDERR, CommandResult


def local_target() -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.LOCAL, binary_dir="/opt", data_dir="/srv/data"
        ),
        binary="/opt/chat-deepseek",
        data_dir="/srv/data",
    )


def remote_target() -> Target:
    return Target(
        endpoint=Endpoint(
            kind=ConnectionKind.SSH,
            host="nas",
            binary_dir="/opt",
            data_dir="/srv/data",
        ),
        binary="/opt/chat-deepseek",
        data_dir="/srv/data",
    )


def result(code: int, stderr: str = "", stdout: str = "") -> CommandResult:
    return CommandResult(("info",), code, stdout, stderr)


class ClassifyTest(unittest.TestCase):
    def test_kind_values_are_strings(self) -> None:
        self.assertEqual(errors.ErrorKind.AUTH, "auth")
        self.assertEqual(errors.ErrorKind.MISSING_BINARY, "missing_binary")

    def test_code_mapping(self) -> None:
        cases = {
            3: errors.ErrorKind.AUTH,
            4: errors.ErrorKind.FORBIDDEN,
            127: errors.ErrorKind.MISSING_BINARY,
            255: errors.ErrorKind.TRANSPORT,
            2: errors.ErrorKind.USAGE,
            1: errors.ErrorKind.UNKNOWN,
            0: errors.ErrorKind.UNKNOWN,
        }
        for code, kind in cases.items():
            with self.subTest(code=code):
                self.assertIs(errors.classify(result(code)), kind)

    def test_timeout_and_cancel_sentinels(self) -> None:
        self.assertIs(
            errors.classify(result(1, TIMEOUT_STDERR)), errors.ErrorKind.TIMEOUT
        )
        self.assertIs(
            errors.classify(result(1, CANCELLED_STDERR)),
            errors.ErrorKind.CANCELLED,
        )


class NormalizeTest(unittest.TestCase):
    def test_success_returns_parsed_value(self) -> None:
        value = errors.normalize(
            result(0, stdout="hello"), target=None, parse=str.strip
        )
        self.assertEqual(value, "hello")

    def test_success_without_parse_returns_result(self) -> None:
        raw = result(0, stdout="hello")
        self.assertIs(errors.normalize(raw, target=None), raw)

    def test_success_bad_output_is_parse_error(self) -> None:
        raw = result(0, stdout="garbage")
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(raw, target=None, parse=parsing.parse_info)
        error = caught.exception
        self.assertIs(error.kind, errors.ErrorKind.PARSE)
        self.assertEqual(error.failure.title, "未知错误")
        self.assertIn("无法处理 chat-deepseek 返回的结果", error.failure.message)
        self.assertIn("garbage", error.failure.details or "")
        self.assertIs(error.raw, raw)

    def test_auth_uses_explain_failure(self) -> None:
        raw = result(3, stderr="登录已失效")
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(raw, target=local_target())
        error = caught.exception
        self.assertIs(error.kind, errors.ErrorKind.AUTH)
        self.assertEqual(error.failure.title, "登录已失效")
        self.assertEqual(error.code, 3)
        self.assertIs(error.raw, raw)

    def test_forbidden(self) -> None:
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result(4, "需要 Owner 权限"), target=None)
        self.assertIs(caught.exception.kind, errors.ErrorKind.FORBIDDEN)
        self.assertEqual(caught.exception.failure.title, "需要 Owner 权限")

    def test_missing_binary_local(self) -> None:
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result(127, "not found"), target=local_target())
        error = caught.exception
        self.assertIs(error.kind, errors.ErrorKind.MISSING_BINARY)
        self.assertEqual(error.failure.title, "找不到 chat-deepseek")
        self.assertIn("设置", error.failure.message)

    def test_missing_binary_remote_names_host(self) -> None:
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result(127, "not found"), target=remote_target())
        self.assertIn("nas", caught.exception.failure.message)

    def test_transport_is_255(self) -> None:
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result(255, "SSH 连接已断开"), target=None)
        error = caught.exception
        self.assertIs(error.kind, errors.ErrorKind.TRANSPORT)
        self.assertEqual(error.failure.title, "SSH 连接已断开")
        self.assertIn("重新登录", error.failure.message)

    def test_usage_is_2(self) -> None:
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(
                result(2, "flag provided but not defined: -x"), target=None
            )
        error = caught.exception
        self.assertIs(error.kind, errors.ErrorKind.USAGE)
        self.assertEqual(error.failure.title, "命令行参数无效")

    def test_usage_fallback(self) -> None:
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result(2, "whatever"), target=None)
        self.assertIs(caught.exception.kind, errors.ErrorKind.USAGE)
        self.assertEqual(caught.exception.failure.title, "命令行参数无效")

    def test_timeout(self) -> None:
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result(1, TIMEOUT_STDERR), target=None)
        error = caught.exception
        self.assertIs(error.kind, errors.ErrorKind.TIMEOUT)
        self.assertEqual(error.failure.title, "命令超时")

    def test_cancelled(self) -> None:
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(result(1, CANCELLED_STDERR), target=None)
        self.assertIs(caught.exception.kind, errors.ErrorKind.CANCELLED)

    def test_unknown_but_known_failure_keeps_parsing_text(self) -> None:
        raw = result(1, "服务正在运行，请先停止")
        with self.assertRaises(errors.CommandError) as caught:
            errors.normalize(raw, target=None)
        error = caught.exception
        self.assertIs(error.kind, errors.ErrorKind.UNKNOWN)
        self.assertEqual(error.failure.title, "服务正在运行")
        self.assertIs(error.raw, raw)


if __name__ == "__main__":
    unittest.main()
