"""界面设计尺度：间距、圆角、字号、控件高度与最小宽度。

页面代码只允许引用这里的有限尺度，不写魔法数字。控件统一收 ``size``，
不再收 ``height``；``size`` 可以是 ``SIZE_ALIASES`` 里的名字，也可以是
``HEIGHTS`` 里的某个值。
"""

from __future__ import annotations

from typing import Final

from PySide6.QtGui import QFont

import theme

#: 布局间距，单位 px。
SPACING: Final[tuple[int, ...]] = (4, 8, 12, 16, 20, 24, 32)

#: 圆角半径；胶囊控件用高度的一半。
RADII: Final[tuple[int, ...]] = (8, 12, 18, 24, 32)

#: 字号。注意 ``theme.font(n)`` 实际渲染 ``n + 1`` px。
FONT_SIZES: Final[tuple[int, ...]] = (11, 12, 13, 15, 22)

#: 控件高度；控件构造参数叫 ``size``。
HEIGHTS: Final[tuple[int, ...]] = (24, 28, 32, 36, 40, 60)

#: 最小宽度。
MIN_WIDTHS: Final[tuple[int, ...]] = (32, 64, 72, 88, 96, 104, 260)

#: 语义化 size 别名。每个值都必须落在 HEIGHTS 里，页面优先用名字。
SIZE_ALIASES: Final[dict[str, int]] = {
    "xs": 24,
    "sm": 28,
    "md": 32,
    "lg": 36,
    "xl": 40,
    "xxl": 60,
}


def _checked(value: int, scale: tuple[int, ...], name: str) -> int:
    if value not in scale:
        raise ValueError(f"{name} {value!r} 不在设计尺度 {scale} 内")
    return value


def space(value: int) -> int:
    """校验并返回间距值。"""
    return _checked(value, SPACING, "间距")


def radius(value: int) -> int:
    """校验并返回圆角半径。"""
    return _checked(value, RADII, "圆角")


def height(value: int) -> int:
    """校验并返回控件高度。"""
    return _checked(value, HEIGHTS, "高度")


def min_width(value: int) -> int:
    """校验并返回最小宽度。"""
    return _checked(value, MIN_WIDTHS, "最小宽度")


def font(size: int, weight: int = 400) -> QFont:
    """校验字号后交给顶层 ``theme.font``，避免各处手写字号。"""
    _checked(size, FONT_SIZES, "字号")
    return theme.font(size, weight)


def resolve_size(size: str | int) -> int:
    """把语义别名或数值解析成 ``HEIGHTS`` 里的高度。"""
    if isinstance(size, str):
        try:
            resolved = SIZE_ALIASES[size]
        except KeyError as error:
            raise ValueError(
                f"未知的 size 别名 {size!r}，可用：{tuple(SIZE_ALIASES)}"
            ) from error
    elif isinstance(size, bool):  # bool 是 int 的子类，单独拦掉
        raise TypeError("size 不能是 bool")
    elif isinstance(size, int):
        resolved = size
    else:
        raise TypeError(f"size 必须是别名或整数，收到 {type(size).__name__}")
    return height(resolved)


def nearest_radius(value: float) -> int:
    """把任意圆角值吸附到 ``RADII`` 上，用于随尺寸缩放的图形。"""
    return min(RADII, key=lambda candidate: abs(candidate - value))
