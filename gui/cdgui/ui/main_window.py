"""主窗口骨架：顶栏、左侧导航、QStackedWidget 内容区、状态栏。

窗口只订阅一次 controller.state，30ms 排空主线程泵，每轮合并成一次渲染。
所有可见性/启用态由 ``render.apply`` 写入；窗口不拼命令、不判断权限，关闭时
只确认前台服务并交给 ``controller.shutdown()``。
"""

from __future__ import annotations

from datetime import datetime

from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QMainWindow,
    QVBoxLayout,
    QWidget,
)

from ..domain import rules
from ..domain.rules import ActionId
from ..domain.state import AppState, Notice, NoticeTone, PageId
from . import palette, tokens
from .login_sheet import LoginSheet
from .pages import (
    AccountsPage,
    BackupsPage,
    Page,
    ServicePage,
    SettingsPage,
)
from .protocols import ControllerProtocol
from .render import UiState, apply, derive_ui
from .views import (
    COMPACT_BREAKPOINT,
    NAV_WIDTH,
    PAGE_ORDER,
    TOP_BAR_HEIGHT,
    Views,
)

WINDOW_TITLE = "chat-deepseek"
WINDOW_WIDTH = 1000
WINDOW_HEIGHT = 760
MIN_WINDOW_WIDTH = 900
MIN_WINDOW_HEIGHT = 740
PUMP_INTERVAL_MS = 30
CLOCK_INTERVAL_MS = 1000

CLOSE_CONFIRM_TITLE = "退出"
CLOSE_CONFIRM_MESSAGE = "服务还在运行。停止服务并退出？"


class MainWindow(QMainWindow):
    """窗口骨架；C5c/C5d 只往四个 Page 里填内容。"""

    def __init__(self, controller: ControllerProtocol) -> None:
        super().__init__()
        self.controller = controller
        self._dirty = False
        self._closing = False
        self._closed = False
        self._active_page: Page | None = None
        self._last_notice_key: tuple[object, ...] | None = None
        self._login_sheet: LoginSheet | None = None
        self._login_dismissed = False
        self._last_login_prompt: object | None = None
        self._login_prompt_username = ""

        self.setWindowTitle(WINDOW_TITLE)
        self.resize(WINDOW_WIDTH, WINDOW_HEIGHT)
        self.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

        pages: dict[PageId, Page] = {
            PageId.SERVICE: ServicePage(controller),
            PageId.ACCOUNTS: AccountsPage(controller),
            PageId.BACKUPS: BackupsPage(controller),
            PageId.SETTINGS: SettingsPage(controller),
        }
        self.views = Views(pages, self)
        self._build()
        self.views.set_compact(self.width() < COMPACT_BREAKPOINT)

        self._unsubscribe = controller.subscribe(self._on_state)
        self._pump_timer = QTimer(self)
        self._pump_timer.setInterval(PUMP_INTERVAL_MS)
        self._pump_timer.timeout.connect(self._drain)
        self._pump_timer.start()
        self._clock_timer = QTimer(self)
        self._clock_timer.setInterval(CLOCK_INTERVAL_MS)
        self._clock_timer.timeout.connect(self._schedule_render)
        self._clock_timer.start()

        self._render()

    # -- 装配 --------------------------------------------------------------

    def _build(self) -> None:
        central = QWidget(self)
        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._build_top_bar())

        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)
        body.addWidget(self._build_nav())
        body.addWidget(self.views.stacked, 1)
        root.addLayout(body, 1)
        self.setCentralWidget(central)

        self._build_status_bar()
        self._connect_actions()
        self._build_shortcuts()

    def _build_top_bar(self) -> QFrame:
        bar = QFrame(self)
        bar.setObjectName("cdguiTopBar")
        bar.setFixedHeight(TOP_BAR_HEIGHT)
        bar.setStyleSheet(
            "QFrame#cdguiTopBar {"
            f" background: {palette.color('bg').name()};"
            f" border-bottom: 1px solid {palette.color('border').name()};"
            " }"
        )
        row = QHBoxLayout(bar)
        row.setContentsMargins(
            tokens.space(20), 0, tokens.space(20), 0
        )
        row.setSpacing(tokens.space(12))
        row.addWidget(self.views.brand, 0, Qt.AlignmentFlag.AlignVCenter)
        row.addWidget(self.views.brand_text, 0, Qt.AlignmentFlag.AlignVCenter)
        row.addWidget(self.views.target_chip, 0, Qt.AlignmentFlag.AlignVCenter)
        row.addStretch(1)
        row.addWidget(self.views.busy_spinner, 0, Qt.AlignmentFlag.AlignVCenter)
        row.addWidget(self.views.service_chip, 0, Qt.AlignmentFlag.AlignVCenter)
        row.addWidget(self.views.identity_chip, 0, Qt.AlignmentFlag.AlignVCenter)
        self.views.top_bar = bar
        return bar

    def _build_nav(self) -> QFrame:
        nav = QFrame(self)
        nav.setObjectName("cdguiNav")
        nav.setFixedWidth(NAV_WIDTH)
        nav.setStyleSheet(
            "QFrame#cdguiNav {"
            f" background: {palette.color('bg').name()};"
            f" border-right: 1px solid {palette.color('border').name()};"
            " }"
        )
        column = QVBoxLayout(nav)
        column.setContentsMargins(
            tokens.space(8), tokens.space(12), tokens.space(8), tokens.space(12)
        )
        column.setSpacing(tokens.space(4))
        for page_id in (PageId.SERVICE, PageId.ACCOUNTS, PageId.BACKUPS):
            column.addWidget(self.views.nav_buttons[page_id])
        column.addStretch(1)
        column.addWidget(self.views.nav_buttons[PageId.SETTINGS])
        self.views.nav_panel = nav
        return nav

    def _build_status_bar(self) -> None:
        status = self.views.status_bar
        status.setStyleSheet(
            "QStatusBar {"
            f" background: {palette.color('bg').name()};"
            f" border-top: 1px solid {palette.color('border').name()};"
            " }"
        )
        status.addWidget(self.views.status_version, 1)
        status.addPermanentWidget(self.views.status_backup)
        status.addPermanentWidget(self.views.status_help)
        self.setStatusBar(status)

    def _connect_actions(self) -> None:
        self.views.target_chip.clicked.connect(self.views.target_chip.show_menu)
        self.views.target_chip.switch_requested.connect(
            lambda: self._request_page(PageId.SETTINGS)
        )
        self.views.service_chip.clicked.connect(
            lambda: self._request_page(PageId.SERVICE)
        )
        self.views.login_button.clicked.connect(self._toggle_identity)
        self.views.identity_chip.clicked.connect(self._toggle_identity)
        for page_id, button in self.views.nav_buttons.items():
            button.clicked.connect(
                lambda _checked=False, page_id=page_id: self._request_page(page_id)
            )
        self.views.status_backup.clicked.connect(
            lambda: self._request_page(PageId.BACKUPS)
        )
        self.views.status_help.clicked.connect(self.controller.show_help)
        self.views.register_button(ActionId.HELP, self.views.status_help)

    def _build_shortcuts(self) -> None:
        self.shortcuts: dict[PageId, QShortcut] = {}
        for index, page_id in enumerate(PAGE_ORDER, start=1):
            shortcut = QShortcut(QKeySequence(f"Ctrl+{index}"), self)
            shortcut.setContext(Qt.ShortcutContext.WindowShortcut)
            shortcut.activated.connect(
                lambda page_id=page_id: self._request_page(page_id)
            )
            self.shortcuts[page_id] = shortcut
        self.settings_shortcut = QShortcut(QKeySequence("Ctrl+,"), self)
        self.settings_shortcut.setContext(Qt.ShortcutContext.WindowShortcut)
        self.settings_shortcut.activated.connect(
            lambda: self._request_page(PageId.SETTINGS)
        )

    # -- 泵与渲染 ----------------------------------------------------------

    def _on_state(self, _state: AppState) -> None:
        self._schedule_render()

    def _schedule_render(self) -> None:
        if self._closing or self._closed or self._dirty:
            return
        self._dirty = True
        QTimer.singleShot(0, self._render)

    def _drain(self) -> None:
        if self._closing or self._closed:
            return
        self.controller.pump.drain()
        # 一轮 drain 可能触发多次 subscribe；合并成一次渲染。
        self._schedule_render()

    def _render(self) -> None:
        self._dirty = False
        if self._closing or self._closed:
            return
        state = self.controller.state
        ui = derive_ui(state, datetime.now())
        apply(ui, self.views, state)
        page = self.views.page(state.page)
        if page is not None and page is not self._active_page:
            self._active_page = page
            page.on_activate()
        self._sync_notice(state)
        self._sync_login(state)

    # -- 导航 --------------------------------------------------------------

    def _request_page(self, page: PageId | str) -> None:
        if self._closing or self._closed:
            return
        try:
            target = PageId(page)
        except ValueError:
            return
        if target not in self.views.pages:
            return
        current_id = self.controller.state.page
        if target == current_id:
            return
        current = self.views.pages.get(current_id)
        if current is not None and not current.can_leave():
            return
        self.controller.set_page(target)
        self._schedule_render()

    # -- 登录 --------------------------------------------------------------

    def _toggle_identity(self) -> None:
        if self._closing or self._closed:
            return
        if self.controller.state.identity is not None:
            self.controller.logout()
            return
        self._login_dismissed = False
        self._last_login_prompt = None
        self.controller.ensure_login()
        state = self.controller.state
        if state.login is not None:
            self._sync_login(state)

    def _submit_login(self, username: str, password: str) -> None:
        if self._closing or self._closed:
            return
        self._login_dismissed = False
        self.controller.login(username, password)

    def _sync_login(self, state: AppState) -> None:
        prompt = state.login
        if prompt is None:
            self._last_login_prompt = None
            self._login_dismissed = False
            self._close_login_sheet()
            return
        if self._last_login_prompt is None:
            self._login_dismissed = False
        self._last_login_prompt = prompt
        if not self.isVisible():
            return
        if self._login_sheet is None:
            if self._login_dismissed:
                return
            sheet = LoginSheet(self)
            sheet.submitted.connect(self._submit_login)
            sheet.rejected.connect(self._on_login_rejected)
            self._login_sheet = sheet
            sheet.set_username(prompt.username)
            self._login_prompt_username = prompt.username
            sheet.open()
        elif prompt.username != self._login_prompt_username:
            self._login_sheet.set_username(prompt.username)
            self._login_prompt_username = prompt.username
        self._login_sheet.set_error(prompt.error)

    def _on_login_rejected(self) -> None:
        self._login_dismissed = True
        sheet = self._login_sheet
        self._login_sheet = None
        if sheet is not None:
            sheet.deleteLater()

    def _close_login_sheet(self) -> None:
        sheet = self._login_sheet
        self._login_sheet = None
        if sheet is None:
            return
        # 成功登录/切换目标导致的关闭不应再被当成“用户取消”。
        sheet.blockSignals(True)
        sheet.close()
        sheet.deleteLater()

    # -- notice ------------------------------------------------------------

    def _sync_notice(self, state: AppState) -> None:
        notice = state.notice
        if notice is None:
            self._last_notice_key = None
            return
        if not self.isVisible():
            return
        key = (
            notice.text,
            notice.title,
            notice.details,
            notice.dialog,
            str(notice.tone),
        )
        if key != self._last_notice_key:
            self._last_notice_key = key
            self._present_notice(notice)
        self.controller.dismiss_notice()

    def _present_notice(self, notice: Notice) -> None:
        if notice.dialog:
            dialogs = self._load_dialogs()
            dialogs.show_message(
                self,
                notice.title or "提示",
                notice.text,
                notice.details or None,
            )
            return
        self.views.toast.show_message(
            notice.text or notice.title,
            error=notice.tone is NoticeTone.ERROR,
        )

    def _load_dialogs(self):
        """C5d 的 ``cdgui.ui.dialogs`` 尚未落地时回退到旧 dialogs。"""
        try:
            from . import dialogs as ui_dialogs
        except ImportError:
            import dialogs as ui_dialogs
        return ui_dialogs

    # -- 关闭 --------------------------------------------------------------

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        if self._closed:
            event.accept()
            return
        if not self._closing:
            state = self.controller.state
            if rules.is_running(state):
                dialogs = self._load_dialogs()
                confirmed = dialogs.ask_confirm(
                    self,
                    CLOSE_CONFIRM_TITLE,
                    CLOSE_CONFIRM_MESSAGE,
                    danger=True,
                )
                if not confirmed:
                    event.ignore()
                    return
            self._closing = True
            self._pump_timer.stop()
            self._clock_timer.stop()
            if self._unsubscribe is not None:
                self._unsubscribe()
                self._unsubscribe = None
            self._close_login_sheet()
            self.controller.shutdown()
            self._closed = True
        event.accept()

    # -- 自适应 ------------------------------------------------------------

    def resizeEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        super().resizeEvent(event)
        self.views.set_compact(event.size().width() < COMPACT_BREAKPOINT)

    def showEvent(self, event) -> None:  # noqa: N802 - Qt 命名
        super().showEvent(event)
        self._schedule_render()

    def current_ui(self) -> UiState:
        """测试/调试用：当前状态的投影。"""
        return derive_ui(self.controller.state, datetime.now())


__all__ = [
    "CLOSE_CONFIRM_MESSAGE",
    "CLOSE_CONFIRM_TITLE",
    "MainWindow",
    "WINDOW_TITLE",
]
