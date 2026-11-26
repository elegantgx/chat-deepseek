"""C5a 控件层：设计尺度、配色映射、基础控件与表单原语。

页面代码只从这里取控件，不直接碰 ``widgets.py`` 的旧实现。
"""

from __future__ import annotations

from . import forms, palette, primitives, tokens
from .forms import CopyRow, DangerRow, FormGrid, FormRow, PathRow
from .palette import GROUP_TONES, TONE_KEYS
from .primitives import (
    Avatar,
    Badge,
    BrandLogo,
    Button,
    Choice,
    Field,
    ListRow,
    LockGlyph,
    SectionHeading,
    Surface,
    Switch,
    SwitchRow,
    Toast,
    button,
)

__all__ = [
    "Avatar",
    "Badge",
    "BrandLogo",
    "Button",
    "Choice",
    "CopyRow",
    "DangerRow",
    "Field",
    "FormGrid",
    "FormRow",
    "GROUP_TONES",
    "ListRow",
    "LockGlyph",
    "PathRow",
    "SectionHeading",
    "Surface",
    "Switch",
    "SwitchRow",
    "TONE_KEYS",
    "Toast",
    "button",
    "forms",
    "palette",
    "primitives",
    "tokens",
]
