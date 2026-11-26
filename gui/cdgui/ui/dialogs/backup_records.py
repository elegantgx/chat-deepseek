"""备份记录弹窗：时间 / 文件名 / 大小列表，选中后返回备份名。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QWidget

from .. import primitives, tokens
from .base import SheetDialog

if TYPE_CHECKING:  # pragma: no cover - 只用于类型提示
    import parsing

#: 恢复备份会覆盖的数据；确认说明必须逐字复述。
RESTORE_WARNING = (
    "恢复会覆盖 chat.db、config.json、master.key 和 files/，请先停止服务。"
)

#: 列表行高度与账户行一致。
ROW_SIZE = "xxl"


class BackupRecordsDialog(SheetDialog):
    """备份记录列表；``value`` 为选中的备份文件名，取消时为 ``None``。"""

    def __init__(
        self,
        parent: QWidget | None,
        backup_dir: str,
        backups: list["parsing.Backup"],
    ) -> None:
        super().__init__(
            parent,
            "备份记录",
            f"备份地址：{backup_dir}",
            width=640,
            body_max_height=420,
        )
        self.selected: str | None = None
        self.rows: list[primitives.ListRow] = []

        self.warning_label = QLabel(RESTORE_WARNING, self._content)
        self.warning_label.setObjectName("cdguiBackupWarning")
        self.warning_label.setFont(tokens.font(12))
        self.warning_label.setProperty("tone", "muted")
        self.warning_label.setWordWrap(True)
        self.add(self.warning_label)

        self.empty_label: QLabel | None = None
        if backups:
            for archive in backups:
                row = self._make_row(archive)
                self.rows.append(row)
                self.add(row)
            self.add_stretch()
        else:
            self.empty_label = QLabel("还没有备份", self._content)
            self.empty_label.setObjectName("cdguiBackupEmpty")
            self.empty_label.setFont(tokens.font(15, 600))
            self.empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.add(self.empty_label)
            self.empty_hint = QLabel(
                "返回主界面点击“立即备份”创建第一个备份。", self._content
            )
            self.empty_hint.setFont(tokens.font(12))
            self.empty_hint.setProperty("tone", "muted")
            self.empty_hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.empty_hint.setWordWrap(True)
            self.add(self.empty_hint)

        self.close_button = self.add_button(
            "关闭",
            kind="secondary",
            default=not self.rows,
            on_click=self.reject,
        )
        self.restore_button = self.add_button(
            "恢复所选",
            kind="danger",
            on_click=self._ok,
            min_width=tokens.min_width(96),
        )
        self.restore_button.setEnabled(False)
        self._initial_focus = self.rows[0] if self.rows else self.close_button

    # -- 列表 --------------------------------------------------------------

    def _make_row(self, archive: "parsing.Backup") -> primitives.ListRow:
        size = QLabel(archive.size, self._content)
        size.setFont(tokens.font(11, 500))
        size.setProperty("tone", "muted")
        size.setAttribute(
            Qt.WidgetAttribute.WA_TransparentForMouseEvents, True
        )
        row = primitives.ListRow(
            title=f"{archive.time:%Y-%m-%d %H:%M:%S}",
            subtitle=archive.name,
            trailing=size,
            key=archive.name,
            size=ROW_SIZE,
            parent=self._content,
        )
        row.clicked.connect(lambda name=archive.name: self._select(name))
        row.toggled.connect(
            lambda checked, name=archive.name: self._toggle(name, checked)
        )
        row.upPressed.connect(lambda row=row: self._move_focus(row, -1))
        row.downPressed.connect(lambda row=row: self._move_focus(row, 1))
        return row

    def _select(self, name: str) -> None:
        if self.selected == name:
            return
        self.selected = name
        for row in self.rows:
            row.set_selected(row.key == name)
        self.restore_button.setEnabled(True)

    def _toggle(self, name: str, checked: bool) -> None:
        if checked:
            self._select(name)
        elif self.selected == name:
            self.selected = None
            for row in self.rows:
                row.set_selected(False)
            self.restore_button.setEnabled(False)

    def _move_focus(self, row: primitives.ListRow, delta: int) -> None:
        index = self.rows.index(row)
        target = max(0, min(len(self.rows) - 1, index + delta))
        self.rows[target].setFocus()

    def _ok(self) -> None:
        if self.selected is None:
            return
        self.value = self.selected
        self.accept()
