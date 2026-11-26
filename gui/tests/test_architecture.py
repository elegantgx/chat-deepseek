"""C7 架构守卫：用 ast 锁住分层、入口和几个已经收敛的设计。

守住的是“代码放在哪、谁能碰什么”，不是行为；所以不需要导入被测模块，
也不起 Qt。每条失败都会带上 ``相对路径:行号``，方便直接定位。
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

GUI_DIR = Path(__file__).resolve().parents[1]
CDGUI_DIR = GUI_DIR / "cdgui"
DOMAIN_DIR = CDGUI_DIR / "domain"
INFRA_DIR = CDGUI_DIR / "infra"
UI_DIR = CDGUI_DIR / "ui"
DIALOGS_DIR = UI_DIR / "dialogs"
PAGES_DIR = UI_DIR / "pages"
APP_PY = GUI_DIR / "app.py"

QT_ROOTS = frozenset({"PySide6", "PySide2", "PyQt5", "PyQt6"})
IO_ROOTS = frozenset({"subprocess", "threading"})
#: C6 已删除的转发壳/旧实现；C7 删掉 widgets.py 后也不允许再出现。
LEGACY_MODULES = frozenset({"cli", "ssh_session", "widgets"})
#: 旧入口包；现在只有 ``cdgui`` 和几个叶子模块。
LEGACY_PACKAGE = "gui"

PAINT_EVENT_LIMIT = 10
APP_LINE_LIMIT = 80


def _python_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts and ".venv" not in path.parts
    )


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _where(path: Path, lineno: int) -> str:
    return f"{path.relative_to(GUI_DIR).as_posix()}:{lineno}"


def _imported_modules(tree: ast.Module):
    """产出 (模块名, 行号)；相对导入保留 ``node.module`` 本身。"""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name, node.lineno
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module, node.lineno


def _root(module: str) -> str:
    return module.split(".", 1)[0]


def _legacy_imports(tree: ast.Module) -> list[tuple[str, int, str]]:
    """返回 (命中模块, 行号, 写法)；相对导入里的名字单独检查。"""
    hits: list[tuple[str, int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = _root(alias.name)
                if root in LEGACY_MODULES or root == LEGACY_PACKAGE:
                    hits.append((alias.name, node.lineno, "import"))
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                # ``from . import cli`` 这类写法：module 为 None，检查导入名。
                for alias in node.names:
                    if _root(alias.name) in LEGACY_MODULES:
                        hits.append(
                            (alias.name, node.lineno, "from . import")
                        )
                continue
            if node.module is None:
                continue
            root = _root(node.module)
            if root in LEGACY_MODULES or root == LEGACY_PACKAGE:
                hits.append((node.module, node.lineno, "from"))
    return hits


def _looks_like_service(expression: ast.expr) -> bool:
    """``service.active`` / ``host.service.active`` / ``self.service.active``。"""
    if isinstance(expression, ast.Name):
        return expression.id == "service"
    if isinstance(expression, ast.Attribute):
        return expression.attr == "service" or _looks_like_service(
            expression.value
        )
    return False


def _layout_hits(tree: ast.Module) -> list[int]:
    """所有引用 ``QGridLayout`` 的行号（import、名字、属性都算）。"""
    lines: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Name, ast.Attribute)):
            name = node.id if isinstance(node, ast.Name) else node.attr
            if name == "QGridLayout":
                lines.append(node.lineno)
        elif isinstance(node, ast.ImportFrom):
            if any(alias.name == "QGridLayout" for alias in node.names):
                lines.append(node.lineno)
        elif isinstance(node, ast.Import):
            if any(
                _root(alias.name) == "QGridLayout" for alias in node.names
            ):
                lines.append(node.lineno)
    return sorted(set(lines))


class ArchitectureTest(unittest.TestCase):
    """8 条静态守卫；失败信息统一是路径 + 行号。"""

    def test_01_domain_has_no_qt(self) -> None:
        failures: list[str] = []
        for path in _python_files(DOMAIN_DIR):
            for module, lineno in _imported_modules(_parse(path)):
                if _root(module) in QT_ROOTS:
                    failures.append(
                        f"{_where(path, lineno)}: domain 不得导入 {module}"
                    )
        self.assertEqual(failures, [], "\n".join(failures))

    def test_02_infra_has_no_qt(self) -> None:
        failures = []
        for path in _python_files(INFRA_DIR):
            for module, lineno in _imported_modules(_parse(path)):
                if _root(module) in QT_ROOTS:
                    failures.append(
                        f"{_where(path, lineno)}: infra 不得导入 {module}"
                    )
        self.assertEqual(failures, [], "\n".join(failures))

    def test_03_ui_has_no_io_or_threads(self) -> None:
        failures = []
        for path in _python_files(UI_DIR):
            for module, lineno in _imported_modules(_parse(path)):
                if _root(module) in IO_ROOTS:
                    failures.append(
                        f"{_where(path, lineno)}: UI 不得导入 {module}"
                        "（I/O 和线程属于 infra）"
                    )
        self.assertEqual(failures, [], "\n".join(failures))

    def test_04_paint_event_budget(self) -> None:
        definitions: list[str] = []
        for path in _python_files(UI_DIR):
            for node in ast.walk(_parse(path)):
                if (
                    isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and node.name == "paintEvent"
                ):
                    definitions.append(_where(path, node.lineno))
        self.assertLessEqual(
            len(definitions),
            PAINT_EVENT_LIMIT,
            "paintEvent 超过上限 "
            f"{PAINT_EVENT_LIMIT}：\n" + "\n".join(definitions),
        )

    def test_05_qgridlayout_is_confined(self) -> None:
        allowed = {UI_DIR / "forms.py"}
        failures = []
        for path in _python_files(UI_DIR):
            for lineno in _layout_hits(_parse(path)):
                if path in allowed or path.parent == DIALOGS_DIR:
                    continue
                failures.append(
                    f"{_where(path, lineno)}: QGridLayout 只允许出现在 "
                    "cdgui/ui/forms.py 和 cdgui/ui/dialogs/*.py"
                )
        self.assertEqual(failures, [], "\n".join(failures))

    def test_06_pages_use_projected_state(self) -> None:
        failures = []
        for path in _python_files(PAGES_DIR):
            for node in ast.walk(_parse(path)):
                if not isinstance(node, ast.Attribute):
                    continue
                if node.attr == "is_owner":
                    if isinstance(node.value, ast.Name) and node.value.id == "ui":
                        continue
                    failures.append(
                        f"{_where(path, node.lineno)}: 页面不得自己判断 "
                        "identity.is_owner，请用 ui.is_owner"
                    )
                elif node.attr == "service_active":
                    # ``rules.service_active`` 是唯一允许的读取方式。
                    if isinstance(node.value, ast.Name) and node.value.id == "rules":
                        continue
                    failures.append(
                        f"{_where(path, node.lineno)}: 页面不得读 "
                        "service_active，请用 rules / Verdict"
                    )
                elif node.attr == "active" and _looks_like_service(node.value):
                    failures.append(
                        f"{_where(path, node.lineno)}: 页面不得读 "
                        "service.active，服务状态判定请用 rules / Verdict"
                    )
        # ``from ... import service_active`` 也一并禁止。
        for path in _python_files(PAGES_DIR):
            for node in ast.walk(_parse(path)):
                if isinstance(node, ast.ImportFrom) and any(
                    alias.name == "service_active" for alias in node.names
                ):
                    failures.append(
                        f"{_where(path, node.lineno)}: 页面不得导入 "
                        "service_active，服务状态判定请用 rules / Verdict"
                    )
        self.assertEqual(failures, [], "\n".join(failures))

    def test_07_app_entry_stays_small(self) -> None:
        lines = APP_PY.read_text(encoding="utf-8").splitlines()
        self.assertLessEqual(
            len(lines),
            APP_LINE_LIMIT,
            f"{_where(APP_PY, APP_LINE_LIMIT + 1)}: app.py 共 {len(lines)} 行，"
            f"上限 {APP_LINE_LIMIT}；界面逻辑应留在 cdgui",
        )

    def test_08_no_legacy_entry_imports(self) -> None:
        failures = []
        for path in _python_files(GUI_DIR):
            for module, lineno, style in _legacy_imports(_parse(path)):
                failures.append(
                    f"{_where(path, lineno)}: 旧入口 {style} {module} 已删除"
                )
        self.assertEqual(failures, [], "\n".join(failures))


if __name__ == "__main__":
    unittest.main()
