"""Views：窗口骨架里全部控件的引用容器。

这里**不存业务状态**，也不判断权限/服务状态；只负责创建控件、收集页面，
并提供 ``set_compact`` / ``register_button`` 这类纯视图操作。所有文本、可见性
和启用态都由 ``render.apply`` 写入。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING

from PySide6.QtCore import QPoint, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import QPainter, QPen
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMenu,
    QPushButton,
    QSizePolicy,
    QStackedWidget,
    QStatusBar,
    QVBoxLayout,
    QWidget,
)

from ..domain.state import PageId
from . import palette, tokens
from .primitives import Avatar, Badge, BrandLogo, Button, LockGlyph, Toast
from .primitives.field import _ElidedLabel

if TYPE_CHECKING:
    from .pages.base import Page

# 窗口骨架的固定尺度：这些不是控件高度尺度，属于外壳布局，单独命名避免
# 页面代码里出现魔法数字。
TOP_BAR_HEIGHT = 56
NAV_WIDTH = 156
NAV_ROW_HEIGHT = 44
STATUS_BAR_HEIGHT = 28
COMPACT_BREAKPOINT = 960

PAGE_ORDER: tuple[PageId, ...] = (
    PageId.SERVICE,
    PageId.ACCOUNTS,
    PageId.BACKUPS,
    PageId.SETTINGS,
)

PAGE_LABELS: dict[PageId, str] = {
    PageId.SERVICE: "服务",
    PageId.ACCOUNTS: "账户",
    PageId.BACKUPS: "备份",
    PageId.SETTINGS: "设置",
}

_SPINNER_SIZE = 12


class TargetChip(Button):
    """顶栏目标 chip：显示当前目标，点击弹出目标菜单。"""

    switch_requested = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__("", kind="ghost", size="md", parent=parent)
        self.setAccessibleName("当前管理目标")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self._full_text = ""
        self._compact = False

    def set_target(
        self,
        text: str,
        *,
        tooltip: str = "",
        compact: bool | None = None,
    ) -> None:
        self._full_text = text or ""
        if compact is not None:
            self._compact = bool(compact)
        self.setText(self._display_text())
        self.setToolTip(tooltip)

    def set_compact(self, compact: bool) -> None:
        if compact == self._compact:
            return
        self._compact = bool(compact)
        self.setText(self._display_text())

    def _display_text(self) -> str:
        if self._compact:
            return self._full_text.split(" · ", 1)[0]
        return self._full_text

    def build_menu(self) -> QMenu:
        """构造目标菜单；测试可以直接取 actions，不弹真实菜单。"""
        menu = QMenu(self)
        menu.setFont(tokens.font(13))
        switch = menu.addAction("切换目标…")
        switch.triggered.connect(self.switch_requested.emit)
        return menu

    def show_menu(self) -> None:
        menu = self.build_menu()
        menu.exec(
            self.mapToGlobal(QPoint(0, self.height() + tokens.space(4)))
        )
        menu.deleteLater()


class ClickableBadge(Badge):
    """可点击的 Badge；Badge 默认把鼠标事件透传，这里收回来。"""

    clicked = Signal()

    def __init__(
        self,
        text: str = "",
        tone: str = "muted",
        kind: str = "soft",
        dot: bool = True,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(text, tone=tone, kind=kind, dot=dot, parent=parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, False)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mouseReleaseEvent(event)

    def keyPressEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter, Qt.Key.Key_Space):
            self.clicked.emit()
            event.accept()
            return
        super().keyPressEvent(event)


class BusySpinner(QWidget):
    """12px 旋转指示器；忙碌时显示在身份 chip 旁。"""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedSize(_SPINNER_SIZE, _SPINNER_SIZE)
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self._angle = 0
        self._timer = QTimer(self)
        self._timer.setInterval(70)
        self._timer.timeout.connect(self._tick)
        self.hide()

    def set_busy(self, busy: bool) -> None:
        if busy:
            self.show()
            if not self._timer.isActive():
                self._timer.start()
        else:
            self._timer.stop()
            self.hide()

    def is_busy(self) -> bool:
        return self._timer.isActive()

    def _tick(self) -> None:
        self._angle = (self._angle + 30) % 360
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        pen = QPen(
            palette.color("primary"),
            2,
            Qt.PenStyle.SolidLine,
            Qt.PenCapStyle.RoundCap,
        )
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        rect = QRectF(self.rect()).adjusted(1.5, 1.5, -1.5, -1.5)
        painter.drawArc(rect, self._angle * 16, 270 * 16)
        painter.end()


class NavButton(QPushButton):
    """左侧导航项：44px 行高、选中胶囊、状态点与数字徽标。"""

    def __init__(
        self,
        text: str,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(text, parent)
        self._badge = ""
        self._dot_tone: str | None = None
        self._selected = False
        self._keyboard_focus = False
        self.setFixedHeight(NAV_ROW_HEIGHT)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setFlat(True)
        self.setAccessibleName(text)

    def set_badge(self, text: str) -> None:
        value = text or ""
        if value == self._badge:
            return
        self._badge = value
        self.update()

    def set_dot(self, tone: str | None) -> None:
        if tone == self._dot_tone:
            return
        self._dot_tone = tone
        self.update()

    def set_selected(self, selected: bool) -> None:
        if selected == self._selected:
            return
        self._selected = bool(selected)
        self.update()

    def is_selected(self) -> bool:
        return self._selected

    def focusInEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self._keyboard_focus = event.reason() in (
            Qt.FocusReason.TabFocusReason,
            Qt.FocusReason.BacktabFocusReason,
            Qt.FocusReason.ShortcutFocusReason,
        )
        self.update()
        super().focusInEvent(event)

    def focusOutEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self._keyboard_focus = False
        self.update()
        super().focusOutEvent(event)

    def enterEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        self.update()
        super().leaveEvent(event)

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        body = QRectF(self.rect()).adjusted(2, 1, -2, -1)

        if self._selected:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(palette.color("selected"))
            painter.drawRoundedRect(body, tokens.radius(12), tokens.radius(12))
            text_color = palette.color("primary")
        elif self.underMouse():
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(palette.color("card_alt"))
            painter.drawRoundedRect(body, tokens.radius(12), tokens.radius(12))
            text_color = palette.color("text")
        else:
            text_color = palette.color("muted")

        if self.hasFocus() and self._keyboard_focus:
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.setPen(QPen(palette.rgba("primary", 150), 1.2))
            painter.drawRoundedRect(
                body.adjusted(1, 1, -1, -1),
                tokens.radius(12),
                tokens.radius(12),
            )

        left = tokens.space(16)
        painter.setPen(text_color)
        painter.setFont(tokens.font(13, 600 if self._selected else 500))
        metrics = painter.fontMetrics()
        baseline = int((self.height() + metrics.ascent() - metrics.descent()) / 2)
        painter.drawText(left, baseline, self.text())

        x = left + metrics.horizontalAdvance(self.text()) + tokens.space(8)
        if self._dot_tone is not None:
            foreground, _ = palette.tone(self._dot_tone)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(foreground)
            painter.drawEllipse(QPoint(int(x + 3), int(self.height() / 2)), 3, 3)

        if self._badge:
            badge_font = tokens.font(11, 500)
            painter.setFont(badge_font)
            painter.setPen(
                palette.color("primary" if self._selected else "muted")
            )
            badge_width = painter.fontMetrics().horizontalAdvance(self._badge)
            painter.drawText(
                self.width() - tokens.space(16) - badge_width,
                baseline,
                self._badge,
            )
        painter.end()


class IdentityChip(QWidget):
    """顶栏身份 chip：锁/头像 + 身份文字 + 登录/退出按钮。"""

    clicked = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(tokens.space(8))

        self.lock = LockGlyph(size="xs", parent=self)
        self.avatar = Avatar("", size="xs", parent=self)
        self.avatar.hide()
        row.addWidget(self.lock, 0, Qt.AlignmentFlag.AlignVCenter)
        row.addWidget(self.avatar, 0, Qt.AlignmentFlag.AlignVCenter)

        # 身份文字必须占住可见宽度：Ignored 策略会在 HBox 里被压到 0，
        # 只剩头像和“退出”。超长时由 _ElidedLabel 中间省略，tooltip 保留全文。
        self.label = _ElidedLabel("未登录", 12, 500, "muted", self)
        self.label.setAttribute(
            Qt.WidgetAttribute.WA_TransparentForMouseEvents, True
        )
        self.label.setSizePolicy(
            QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Preferred
        )
        self.label.setMinimumWidth(tokens.min_width(260))
        row.addWidget(self.label, 1)

        self.button = Button("登录", kind="secondary", size="sm", parent=self)
        row.addWidget(self.button, 0, Qt.AlignmentFlag.AlignVCenter)

        self.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mouseReleaseEvent(event)

    def set_identity(
        self,
        text: str,
        *,
        tooltip: str = "",
        username: str = "",
        logged_in: bool = False,
        button_text: str = "登录",
        button_tooltip: str = "",
    ) -> None:
        self.lock.setVisible(not logged_in)
        self.avatar.setVisible(logged_in)
        if logged_in:
            self.avatar.set_username(username)
        # _ElidedLabel.setText 会把全文放进 label 的 tooltip，省略时仍可读；
        # chip 自身的 tooltip 用更完整的账户/组/过期信息。
        self.label.setText(text)
        self.setToolTip(tooltip or text)
        self.setAccessibleName(text)
        if self.button.text() != button_text:
            self.button.setText(button_text)
        self.button.setToolTip(button_tooltip)


class Views:
    """窗口骨架的控件引用集合；由 MainWindow 装配布局并持有。"""

    def __init__(
        self,
        pages: Mapping[PageId, Page],
        parent: QWidget | None = None,
    ) -> None:
        self.pages: dict[PageId, Page] = dict(pages)
        self.action_buttons: dict[object, QWidget] = {}
        self._compact = False

        self.stacked = QStackedWidget(parent)
        for page_id in PAGE_ORDER:
            page = self.pages.get(page_id)
            if page is not None:
                self.stacked.addWidget(page.widget)

        # 顶栏
        self.brand = BrandLogo(size="xl", parent=parent)
        self.brand_text = QWidget(parent)
        brand_column = QVBoxLayout(self.brand_text)
        brand_column.setContentsMargins(0, 0, 0, 0)
        brand_column.setSpacing(0)
        self.brand_title = QLabel("chat-deepseek", self.brand_text)
        self.brand_title.setFont(tokens.font(15, 600))
        self.brand_subtitle = QLabel("自托管服务管理", self.brand_text)
        self.brand_subtitle.setFont(tokens.font(11))
        self.brand_subtitle.setProperty("tone", "muted")
        brand_column.addWidget(self.brand_title)
        brand_column.addWidget(self.brand_subtitle)

        self.target_chip = TargetChip(parent)
        self.busy_spinner = BusySpinner(parent)
        self.service_chip = ClickableBadge(
            "尚未启动", tone="muted", kind="soft", dot=True, parent=parent
        )
        self.identity_chip = IdentityChip(parent)
        self.identity_lock = self.identity_chip.lock
        self.identity_avatar = self.identity_chip.avatar
        self.identity_label = self.identity_chip.label
        self.login_button = self.identity_chip.button

        # 左侧导航
        self.nav_buttons: dict[PageId, NavButton] = {
            page_id: NavButton(PAGE_LABELS[page_id], parent)
            for page_id in PAGE_ORDER
        }

        # 状态栏
        self.status_bar = QStatusBar(parent)
        self.status_bar.setSizeGripEnabled(False)
        self.status_bar.setFixedHeight(STATUS_BAR_HEIGHT)
        self.status_version = QLabel("chat-deepseek", self.status_bar)
        self.status_version.setFont(tokens.font(11))
        self.status_version.setProperty("tone", "muted")
        self.status_backup = Button(
            "", kind="ghost", size="sm", parent=self.status_bar
        )
        self.status_backup.setAccessibleName("最近备份")
        self.status_help = Button(
            "命令行帮助", kind="ghost", size="sm", parent=self.status_bar
        )
        self.status_help.setAccessibleName("命令行帮助")

        self.toast = Toast(parent)

    # -- 纯视图操作 --------------------------------------------------------

    def page(self, page_id: PageId | str) -> Page | None:
        try:
            return self.pages.get(PageId(page_id))
        except ValueError:
            return None

    def register_button(self, action, widget: QWidget) -> None:
        """页面把动作按钮登记进来，apply 统一写 visible/enabled/text/tooltip。"""
        self.action_buttons[action] = widget

    def set_compact(self, compact: bool) -> None:
        compact = bool(compact)
        if compact == self._compact:
            return
        self._compact = compact
        self.brand_text.setVisible(not compact)
        self.target_chip.set_compact(compact)

    def is_compact(self) -> bool:
        return self._compact


__all__ = [
    "BusySpinner",
    "ClickableBadge",
    "COMPACT_BREAKPOINT",
    "IdentityChip",
    "NAV_ROW_HEIGHT",
    "NAV_WIDTH",
    "NavButton",
    "PAGE_LABELS",
    "PAGE_ORDER",
    "STATUS_BAR_HEIGHT",
    "TOP_BAR_HEIGHT",
    "TargetChip",
    "Views",
]
