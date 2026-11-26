"""C5a 控件层：设计尺度、配色映射、基础控件与表单原语。

页面代码从 ``cdgui.ui`` 或本包 re-export 取控件，不直接碰旧 ``widgets.py``。
自绘 ``paintEvent`` 仍为 8 个：Button、Badge、Switch、Choice、Avatar、ListRow、
BrandLogo、LockGlyph。
"""

from __future__ import annotations

from .avatar import Avatar
from .badge import Badge
from .button import Button, button
from .field import Field, _ElidedLabel
from .glyph import BrandLogo, LockGlyph
from .list_row import ListRow
from .surface import SectionHeading, Surface
from .toast import Toast
from .toggle import Choice, Switch, SwitchRow

__all__ = [
    "Avatar",
    "Badge",
    "BrandLogo",
    "Button",
    "Choice",
    "Field",
    "ListRow",
    "LockGlyph",
    "SectionHeading",
    "Surface",
    "Switch",
    "SwitchRow",
    "Toast",
    "button",
]
