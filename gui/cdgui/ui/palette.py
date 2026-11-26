"""tone → (前景色, 背景色) 与组角色 → tone 的唯一映射。

颜色一律从 ``theme.colors()`` 取，``ui/`` 下没有散落的色值。控件只认 tone
名字，不关心当前明暗主题；主题切换后重新取色即可。
"""

from __future__ import annotations

from PySide6.QtGui import QColor
from PySide6.QtWidgets import QGraphicsDropShadowEffect, QWidget

import theme

#: tone 名 → (前景 token, 背景 token)。这是全局唯一一份映射。
TONE_KEYS: dict[str, tuple[str, str]] = {
    "muted": ("muted", "muted_soft"),
    "primary": ("primary", "primary_soft"),
    "success": ("success", "success_soft"),
    "warning": ("warning", "warning_soft"),
    "danger": ("danger", "danger_soft"),
}

#: 组角色 → tone；未知组按普通用户处理。
GROUP_TONES: dict[str, str] = {
    "Owner": "primary",
    "Admin": "warning",
    "User": "muted",
}

_TONE_ALIASES: dict[str, str] = {
    "neutral": "muted",
    "info": "primary",
    "error": "danger",
}


def color(name: str) -> QColor:
    """按 token 名取当前主题颜色；名字不存在时抛 ``KeyError``。"""
    values = theme.colors()
    if name not in values:
        raise KeyError(f"未知颜色 token：{name!r}")
    value = values[name]
    if isinstance(value, tuple):
        return QColor(*value)  # type: ignore[arg-type]
    return QColor(str(value))


def tone_name(name: str) -> str:
    """归一化 tone 名；未知 tone 退回 ``muted``，不让界面因拼写崩掉。"""
    normalized = _TONE_ALIASES.get(name, name)
    return normalized if normalized in TONE_KEYS else "muted"


def tone(name: str) -> tuple[QColor, QColor]:
    """返回 tone 的 ``(前景, 背景)``。"""
    foreground, background = TONE_KEYS[tone_name(name)]
    return color(foreground), color(background)


def group_tone(group: str) -> str:
    """组角色 → tone；未知组按 ``User`` 的中性色处理。"""
    return GROUP_TONES.get(group, "muted")


def group(group_name: str) -> tuple[QColor, QColor]:
    """组角色的 ``(前景, 背景)``。"""
    return tone(group_tone(group_name))


def mix(first: str, second: str, ratio: float) -> QColor:
    """在两个主题 token 之间插值，避免控件里出现十六进制色值。"""
    values = theme.colors()
    return QColor(theme.mix(str(values[first]), str(values[second]), ratio))


def rgba(name: str, alpha: int) -> QColor:
    """主题颜色 + 透明度；alpha 为 0–255。"""
    base = color(name)
    base.setAlpha(alpha)
    return base


def on_accent() -> QColor:
    """主色填充上的文字色。亮色主题用 card（白），暗色用 text（近白）。"""
    return color("text") if theme.is_dark() else color("card")


def shadow_color() -> QColor:
    """卡片投影颜色；只取 theme.colors() 里的 shadow token。"""
    red, green, blue, _ = theme.colors()["shadow"]  # type: ignore[misc]
    return QColor(red, green, blue, 150 if theme.is_dark() else 70)


def shadow(
    widget: QWidget, blur: int = 30, dy: int = 8, alpha: int = 70
) -> QGraphicsDropShadowEffect:
    """包装 theme.shadow，让 ui/ 不直接依赖主题模块。"""
    return theme.shadow(widget, blur=blur, dy=dy, alpha=alpha)
