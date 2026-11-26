#!/usr/bin/env python3
"""chat-deepseek 管理界面的启动入口。

这里只做四件事：算好 `GUI_DIR` 与 `sys.path`、建 `QApplication`、装主题、
调用 `cdgui.bootstrap.build_application()` 并进入事件循环。窗口、状态机和
CLI 交互都在 `cdgui/` 里，本文件不再保留任何界面逻辑。
"""

from __future__ import annotations

import sys
from pathlib import Path

GUI_DIR = Path(__file__).resolve().parent
if getattr(sys, "frozen", False):
    # PyInstaller 单文件模式把资源解压到 sys._MEIPASS；assets/ 也放在这一层。
    GUI_DIR = Path(getattr(sys, "_MEIPASS", GUI_DIR))
if str(GUI_DIR) not in sys.path:
    sys.path.insert(0, str(GUI_DIR))

try:
    from PySide6.QtCore import Qt
    from PySide6.QtWidgets import QApplication
except ImportError as exc:  # pragma: no cover - 依赖缺失时给出可操作提示
    raise SystemExit(
        "需要 PySide6；请按 gui/README.md 创建 venv 并安装依赖"
    ) from exc

import theme
from cdgui.bootstrap import build_application


def main() -> None:
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    application = QApplication(sys.argv)
    application.setApplicationName("chat-deepseek")
    theme.install(application)
    window, _controller = build_application()
    window.show()
    raise SystemExit(application.exec())


if __name__ == "__main__":
    main()
