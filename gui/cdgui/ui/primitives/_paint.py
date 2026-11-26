"""控件共用的绘制辅助：胶囊路径、连续圆角与 QSS 颜色字面量。"""

from __future__ import annotations

from PySide6.QtCore import QRectF
from PySide6.QtGui import QColor, QPainterPath


# ---------------------------------------------------------------------------
# 绘制辅助
# ---------------------------------------------------------------------------


def _capsule_path(rect: QRectF) -> QPainterPath:
    path = QPainterPath()
    radius = rect.height() / 2
    path.addRoundedRect(rect, radius, radius)
    return path


def _rounded_path(rect: QRectF, radius: float) -> QPainterPath:
    """连续曲率圆角矩形：直边 → 零曲率圆角 → 直边。"""
    r = min(radius, rect.width() / 2, rect.height() / 2)
    path = QPainterPath()
    if r <= 0:
        path.addRect(rect)
        return path

    left, top = rect.left(), rect.top()
    right, bottom = rect.right(), rect.bottom()

    def curve_points() -> list[tuple[float, float]]:
        # 两端沿边线切入的圆角；用二次贝塞尔近似，视觉上比纯圆弧顺滑。
        steps = 10
        result: list[tuple[float, float]] = []
        for index in range(steps + 1):
            t = index / steps
            x = (1 - t) ** 2 * 0 + 2 * (1 - t) * t * (r * 0.30) + t**2 * r
            y = (1 - t) ** 2 * r + 2 * (1 - t) * t * (r * 0.30) + t**2 * 0
            result.append((x, y))
        return result

    points = curve_points()
    path.moveTo(left + r, top)
    path.lineTo(right - r, top)
    for x, y in reversed(points):
        path.lineTo(right - x, top + y)
    path.lineTo(right, bottom - r)
    for x, y in points:
        path.lineTo(right - x, bottom - y)
    path.lineTo(left + r, bottom)
    for x, y in reversed(points):
        path.lineTo(left + x, bottom - y)
    path.lineTo(left, top + r)
    for x, y in points:
        path.lineTo(left + x, top + y)
    path.closeSubpath()
    return path


def _qss(color: QColor) -> str:
    """QSS 颜色字面量；本项目颜色都来自 theme，不在这里新增色值。"""
    if color.alpha() < 255:
        return f"rgba({color.red()}, {color.green()}, {color.blue()}, {color.alpha()})"
    return color.name()
