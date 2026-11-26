"""CLI 退出码与输出错误的归一化。

映射以 `REFACTOR_PLAN.md` §5.4 / `BEHAVIOR_BASELINE.md` §1 为准：3→AUTH、
4→FORBIDDEN、127→MISSING_BINARY、255→TRANSPORT、2→USAGE；超时、取消和
解析失败各一类，其余交给 `parsing.explain_failure`。这里**不另写一套中文
文案**：已知失败一律先走 `explain_failure`，只有它识别不了的类别才补一条
固定说明（超时/取消/SSH 断开/缺失二进制）。
"""

from __future__ import annotations

from typing import Callable, TypeVar

import parsing

from ..domain.target import StrEnum, Target
from .process import (
    CANCELLED_STDERR,
    TIMEOUT_STDERR,
    CommandResult,
)

T = TypeVar("T")


class ErrorKind(StrEnum):
    AUTH = "auth"
    FORBIDDEN = "forbidden"
    TRANSPORT = "transport"
    MISSING_BINARY = "missing_binary"
    USAGE = "usage"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    PARSE = "parse"
    UNKNOWN = "unknown"


_KIND_BY_CODE = {
    3: ErrorKind.AUTH,
    4: ErrorKind.FORBIDDEN,
    127: ErrorKind.MISSING_BINARY,
    255: ErrorKind.TRANSPORT,
    2: ErrorKind.USAGE,
}


class CommandError(Exception):
    """一条命令失败；`failure` 可以直接展示，`raw` 保留原始结果。"""

    def __init__(
        self,
        kind: ErrorKind,
        failure: parsing.Failure,
        code: int | None = None,
        raw: CommandResult | None = None,
    ) -> None:
        self.kind = ErrorKind(kind)
        self.failure = failure
        self.code = code
        self.raw = raw
        super().__init__(failure.title)


def classify(result: CommandResult) -> ErrorKind:
    """只看退出码和固定说明，把结果归到一个 ErrorKind。"""
    if result.code == 1 and result.stderr.startswith(CANCELLED_STDERR):
        return ErrorKind.CANCELLED
    if result.code == 1 and result.stderr.startswith(TIMEOUT_STDERR):
        return ErrorKind.TIMEOUT
    return _KIND_BY_CODE.get(result.code, ErrorKind.UNKNOWN)


def normalize(
    result: CommandResult,
    *,
    target: Target | None,
    parse: Callable[[str], T] | None = None,
) -> T | CommandResult:
    """成功时解析 stdout，失败时抛 CommandError。

    `parse` 为 None 时成功直接返回 `CommandResult`；解析函数应抛
    `parsing.ParseError`，这里统一转成 PARSE（原始输出放进 details）。
    """
    if result.ok:
        if parse is None:
            return result
        try:
            return parse(result.stdout)
        except parsing.ParseError as exc:
            failure = parsing.unknown_output(
                "无法处理 chat-deepseek 返回的结果。",
                result.stdout,
                result.stderr,
                result.code,
            )
            raise CommandError(
                ErrorKind.PARSE, failure, result.code, result
            ) from exc

    kind = classify(result)
    failure = _failure(kind, result, target)
    raise CommandError(kind, failure, result.code, result)


def _failure(
    kind: ErrorKind, result: CommandResult, target: Target | None
) -> parsing.Failure:
    """先让 parsing 翻译已知 CLI 失败，再补基础设施类别。"""
    failure = parsing.explain_failure(
        result.stderr, result.stdout, result.args, result.code
    )
    if kind is ErrorKind.CANCELLED:
        return parsing.Failure("已取消", "命令已取消。")
    if kind is ErrorKind.TIMEOUT:
        return parsing.Failure(
            "命令超时",
            "命令执行时间过长，已终止。请重试，或检查目标是否仍然可用。",
        )
    if kind is ErrorKind.TRANSPORT:
        # 255 表示常驻通道断开或超时；原始说明放进 details 方便排查。
        return parsing.Failure(
            "SSH 连接已断开",
            "常驻通道已关闭，请重新登录后重试。",
            failure.details,
        )
    if kind is ErrorKind.MISSING_BINARY and failure.title == "未知错误":
        return parsing.Failure(
            "找不到 chat-deepseek",
            _missing_binary_message(target),
            failure.details,
        )
    if kind is ErrorKind.USAGE and failure.title == "未知错误":
        return parsing.Failure(
            "命令行参数无效",
            "界面传递的参数与 chat-deepseek 不匹配，请确认二进制版本。",
            failure.details,
        )
    return failure


def _missing_binary_message(target: Target | None) -> str:
    if target is not None and target.remote:
        return (
            f"远端主机 {target.host} 上没有找到 chat-deepseek，"
            "请检查设置里的远端二进制目录。"
        )
    return "请到设置里选择 chat-deepseek 所在的二进制目录。"
