"""C5d 对话框测试：构造、默认值、校验红字、返回值与安装两种形态。

全部用 offscreen Qt 运行；模态函数通过替换 ``exec_modal`` / 对话框类来
避免真的进入事件循环。
"""

from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtCore import Qt
from PySide6.QtGui import QFontDatabase, QGuiApplication
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication, QDialog, QWidget

import theme
from cdgui.ui import dialogs
from cdgui.ui.dialogs import confirm as confirm_module
from cdgui.ui.dialogs import message as message_module
from cdgui.ui.dialogs.base import FormDialog, SheetDialog
from cdgui.ui.forms import FormRow
from cdgui.ui.primitives import Field


class _SampleForm(FormDialog):
    """验证 FormDialog 的提交钩子，不引入业务字段。"""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent, "示例", "", submit_text="保存")
        self.field = Field(kind="text", placeholder="值")
        self.grid.add(FormRow("值", self.field), key="value")

    def form_error(self) -> str:
        return "" if self.field.text() else "值不能为空"

    def form_value(self):
        return self.field.text()


class UiDialogsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        self._dark_hint = theme._dark_hint
        theme._dark_hint = False
        self._dialogs: list[QDialog] = []

    def tearDown(self) -> None:
        for dialog in self._dialogs:
            dialog.close()
            dialog.deleteLater()
        self._dialogs.clear()
        self.app.processEvents()
        theme._dark_hint = self._dark_hint

    def _track(self, dialog):
        self._dialogs.append(dialog)
        return dialog

    # -- SheetDialog / FormDialog ------------------------------------------

    def test_sheet_dialog_uses_native_chrome_and_error_label(self) -> None:
        dialog = self._track(
            SheetDialog(None, "标题", "一段说明", width=460)
        )
        self.assertEqual(dialog.windowTitle(), "标题")
        self.assertEqual(dialog.title_label.text(), "标题")
        self.assertEqual(dialog.description_label.text(), "一段说明")
        self.assertTrue(dialog.description_label.isVisibleTo(dialog))
        self.assertEqual(
            int(dialog.windowFlags()) & int(Qt.WindowType.FramelessWindowHint), 0
        )
        self.assertTrue(dialog.isModal())
        self.assertTrue(dialog._error.isHidden())
        self.assertEqual(dialog._error.property("tone"), "danger")
        dialog._show_error("出错了")
        self.assertFalse(dialog._error.isHidden())
        self.assertEqual(dialog._error.text(), "出错了")
        dialog._clear_error()
        self.assertTrue(dialog._error.isHidden())
        dialog.reject()
        self.assertIsNone(dialog.value)

    def test_form_dialog_submits_only_after_validation(self) -> None:
        dialog = self._track(_SampleForm())
        self.assertFalse(dialog.submit())
        self.assertEqual(dialog._error.text(), "值不能为空")
        self.assertIsNone(dialog.value)
        dialog.field.setText("hello")
        self.assertTrue(dialog.submit())
        self.assertEqual(dialog.value, "hello")
        self.assertEqual(dialog.result(), int(QDialog.DialogCode.Accepted))

    # -- AccountForm -------------------------------------------------------

    def test_account_owner_mode_has_no_group_rows(self) -> None:
        dialog = self._track(dialogs.AccountForm(None, mode="owner"))
        self.assertEqual(dialog.windowTitle(), "创建 Owner")
        self.assertEqual(dialog.description_label.text(), "第一个账户会成为 Owner。")
        self.assertEqual(dialog.grid.keys(), ("username", "password", "confirm"))
        self.assertIsNone(dialog.admin)
        self.assertIsNone(dialog.owner)

        dialog.username.setText("owner")
        dialog.password.setText("password123")
        dialog.confirm.setText("password123")
        self.assertTrue(dialog.submit())
        self.assertEqual(dialog.value, ("owner", "password123", ()))

    def test_account_user_mode_can_add_admin_and_owner_groups(self) -> None:
        dialog = self._track(
            dialogs.AccountForm(None, mode="user", allow_groups=True)
        )
        self.assertEqual(dialog.windowTitle(), "添加用户")
        self.assertIn("groups", dialog.grid.keys())
        self.assertIsNotNone(dialog.admin)
        self.assertIsNotNone(dialog.owner)
        dialog.username.setText("alice")
        dialog.password.setText("password123")
        dialog.confirm.setText("password123")
        dialog.admin.setChecked(True)
        dialog.owner.setChecked(True)
        self.assertTrue(dialog.submit())
        self.assertEqual(dialog.value, ("alice", "password123", ("Admin", "Owner")))

    def test_account_admin_mode_cannot_pick_groups(self) -> None:
        dialog = self._track(
            dialogs.AccountForm(None, mode="user", allow_groups=False)
        )
        self.assertEqual(
            dialog.description_label.text(),
            "新用户默认属于 User 组；Admin 不能指定附加组。",
        )
        self.assertNotIn("groups", dialog.grid.keys())
        dialog.username.setText("bob")
        dialog.password.setText("password123")
        dialog.confirm.setText("password123")
        self.assertTrue(dialog.submit())
        self.assertEqual(dialog.value, ("bob", "password123", ()))

    def test_account_validation_texts_and_cancel(self) -> None:
        dialog = self._track(dialogs.AccountForm(None, mode="owner"))
        dialog.username.setText("  ")
        self.assertFalse(dialog.submit())
        self.assertEqual(dialog._error.text(), "用户名不能为空")

        dialog.username.setText("alice")
        dialog.password.setText("short")
        dialog.confirm.setText("short")
        self.assertFalse(dialog.submit())
        self.assertEqual(dialog._error.text(), "密码长度需在 8–1024 位之间")

        dialog.password.setText("password123")
        dialog.confirm.setText("password124")
        self.assertFalse(dialog.submit())
        self.assertEqual(dialog._error.text(), "两次输入的密码不一致")

        dialog.reject()
        self.assertIsNone(dialog.value)

        with self.assertRaises(ValueError):
            self._track(dialogs.AccountForm(None, mode="nope"))

    # -- PasswordForm ------------------------------------------------------

    def test_password_form_validates_and_returns_string(self) -> None:
        dialog = self._track(dialogs.PasswordForm(None, "alice"))
        self.assertEqual(dialog.windowTitle(), "重置密码")
        self.assertIn("alice", dialog.description_label.text())
        dialog.password.setText("short")
        dialog.confirm.setText("short")
        self.assertFalse(dialog.submit())
        self.assertEqual(dialog._error.text(), "密码长度需在 8–1024 位之间")

        dialog.password.setText("password123")
        dialog.confirm.setText("password124")
        self.assertFalse(dialog.submit())
        self.assertEqual(dialog._error.text(), "两次输入的密码不一致")

        dialog.confirm.setText("password123")
        self.assertTrue(dialog.submit())
        self.assertEqual(dialog.value, "password123")

    # -- GroupForm ---------------------------------------------------------

    def test_group_form_defaults_to_admin_and_returns_choice(self) -> None:
        dialog = self._track(dialogs.GroupForm(None, "alice", add=True))
        self.assertEqual(dialog.windowTitle(), "授予组")
        self.assertEqual(dialog.description_label.text(), "授予 alice 的组")
        self.assertEqual([choice.text() for choice in dialog.choices], ["User", "Admin", "Owner"])
        self.assertEqual(dialog.checked_group(), "Admin")
        self.assertEqual(len(dialog.group.buttons()), 3)

        dialog.choices[2].click()
        self.assertEqual(dialog.checked_group(), "Owner")
        self.assertTrue(dialog.submit())
        self.assertEqual(dialog.value, "Owner")

        revoked = self._track(dialogs.GroupForm(None, "alice", add=False))
        self.assertEqual(revoked.windowTitle(), "撤销组")
        self.assertEqual(revoked.description_label.text(), "撤销 alice 的组")
        revoked.reject()
        self.assertIsNone(revoked.value)

    # -- ConfirmDialog -----------------------------------------------------

    def test_confirm_defaults_to_cancel_and_danger_primary(self) -> None:
        dialog = self._track(
            dialogs.ConfirmDialog(None, "删除账户", "确定删除？", danger=True)
        )
        self.assertEqual(dialog.windowTitle(), "删除账户")
        self.assertEqual(dialog.message_label.text(), "确定删除？")
        self.assertEqual(dialog.primary_button.kind, "danger")
        self.assertTrue(dialog.cancel_button.isDefault())
        self.assertIs(dialog._initial_focus, dialog.cancel_button)

        dialog.show()
        self.app.processEvents()
        self.assertTrue(dialog.cancel_button.hasFocus())

        dialog._ok()
        self.assertIs(dialog.value, True)

    def test_ask_confirm_returns_bool(self) -> None:
        created: dict[str, object] = {}

        class FakeConfirm:
            def __init__(self, parent, title, message, danger=False) -> None:
                created.update(
                    parent=parent, title=title, message=message, danger=danger
                )
                self.value = None

            def exec_modal(self):
                self.value = True
                return self.value

        with mock.patch.object(confirm_module, "ConfirmDialog", FakeConfirm):
            self.assertTrue(
                dialogs.ask_confirm(None, "标题", "消息", danger=True)
            )
        self.assertEqual(created["title"], "标题")
        self.assertEqual(created["message"], "消息")
        self.assertIs(created["danger"], True)

        class FakeCancel(FakeConfirm):
            def exec_modal(self):
                return None

        with mock.patch.object(confirm_module, "ConfirmDialog", FakeCancel):
            self.assertFalse(dialogs.ask_confirm(None, "标题", "消息"))

    # -- MessageDialog -----------------------------------------------------

    def test_message_details_are_readonly_and_monospace(self) -> None:
        dialog = self._track(
            dialogs.MessageDialog(None, "错误", "命令失败", details="line1\nline2")
        )
        self.assertEqual(dialog.message_label.text(), "命令失败")
        self.assertIsNotNone(dialog.details_edit)
        self.assertTrue(dialog.details_edit.isReadOnly())
        self.assertEqual(dialog.details, "line1\nline2")
        fixed = QFontDatabase.systemFont(QFontDatabase.SystemFont.FixedFont)
        self.assertEqual(dialog.details_edit.font().family(), fixed.family())
        self.assertEqual(dialog.close_button.text(), "关闭")
        self.assertTrue(dialog.close_button.isDefault())
        self.assertIs(dialog._initial_focus, dialog.close_button)

        plain = self._track(dialogs.MessageDialog(None, "提示", "好了"))
        self.assertIsNone(plain.details_edit)

    def test_show_message_does_not_return_value(self) -> None:
        created: dict[str, object] = {}

        class FakeMessage:
            def __init__(self, parent, title, message, details=None) -> None:
                created.update(
                    title=title, message=message, details=details
                )

            def exec_modal(self):
                return None

        with mock.patch.object(message_module, "MessageDialog", FakeMessage):
            self.assertIsNone(
                dialogs.show_message(None, "标题", "消息", details="详情")
            )
        self.assertEqual(created["title"], "标题")
        self.assertEqual(created["details"], "详情")

    # -- ServiceInstallSheet ----------------------------------------------

    def test_service_install_user_scope_defaults(self) -> None:
        dialog = self._track(
            dialogs.ServiceInstallSheet(
                None,
                binary="/opt/chat-deepseek",
                data_dir="/srv/data",
                linger=False,
                username="gx",
            )
        )
        self.assertEqual(dialog.windowTitle(), "安装服务")
        self.assertIsNotNone(dialog.scope_field)
        self.assertEqual(dialog.scope_field.value(), "user")
        self.assertTrue(dialog.enable.isChecked())
        self.assertTrue(dialog.start.isChecked())
        self.assertEqual(dialog.start_row.label.text(), "安装后立即启动")
        self.assertEqual(
            dialog.linger_row.text(), "loginctl enable-linger gx"
        )
        self.assertFalse(dialog.primary_button.isHidden())
        self.assertEqual(dialog.cancel_button.text(), "取消")
        self.assertTrue(dialog.install_row.isHidden())

        dialog._ok()
        self.assertEqual(
            dialog.value,
            {"scope": "user", "enable": True, "start": True, "force": False},
        )

    def test_service_install_system_scope_only_shows_commands(self) -> None:
        dialog = self._track(
            dialogs.ServiceInstallSheet(
                None,
                binary="/opt/chat-deepseek",
                data_dir="/srv/data",
                linger=True,
                username="gx",
                host="nas",
            )
        )
        with mock.patch.object(subprocess, "run") as run, mock.patch.object(
            subprocess, "Popen"
        ) as popen:
            dialog.scope_field.setValue("system")

        self.assertEqual(dialog.scope, "system")
        self.assertTrue(dialog.primary_button.isHidden())
        self.assertTrue(dialog.start_row.isHidden())
        self.assertTrue(dialog.linger_row.isHidden())
        self.assertFalse(dialog.install_row.isHidden())
        self.assertFalse(dialog.help_row.isHidden())
        self.assertEqual(dialog.cancel_button.text(), "关闭")
        self.assertTrue(dialog.cancel_button.isDefault())

        command = dialog.install_row.text()
        self.assertIn("ssh -t nas", command)
        self.assertIn("sudo", command)
        self.assertIn("service install", command)
        self.assertIn("--system", command)
        self.assertIn("--run-as gx", command)
        self.assertIn("--data-dir /srv/data", command)
        self.assertIn("service --help", dialog.help_row.text())

        # 系统目录只给命令：不执行，也不产生安装参数。
        dialog._ok()
        self.assertIsNone(dialog.value)
        run.assert_not_called()
        popen.assert_not_called()

        dialog.scope_field.setValue("user")
        self.assertEqual(dialog.scope, "user")
        self.assertEqual(dialog.cancel_button.text(), "取消")
        self.assertFalse(dialog.start_row.isHidden())
        self.assertFalse(dialog.linger_row.isHidden())
        self.assertTrue(dialog.install_row.isHidden())
        self.assertFalse(dialog.primary_button.isHidden())

    def test_service_install_update_uses_force_and_restart_label(self) -> None:
        dialog = self._track(
            dialogs.ServiceInstallSheet(
                None,
                binary="/opt/chat-deepseek",
                data_dir="/srv/data",
                linger=False,
                username="gx",
                installed=True,
                enabled=False,
                active=True,
            )
        )
        self.assertEqual(dialog.windowTitle(), "更新服务")
        self.assertIsNone(dialog.scope_field)
        self.assertEqual(dialog.start_row.label.text(), "更新后重启服务")
        self.assertFalse(dialog.enable.isChecked())
        self.assertEqual(dialog.primary_button.text(), "更新")
        dialog._ok()
        self.assertEqual(
            dialog.value,
            {"scope": "user", "enable": False, "start": True, "force": True},
        )

        stopped = self._track(
            dialogs.ServiceInstallSheet(
                None,
                binary="/opt/chat-deepseek",
                data_dir="/srv/data",
                linger=True,
                username="gx",
                installed=True,
                enabled=True,
                active=False,
            )
        )
        self.assertEqual(stopped.start_row.label.text(), "更新后启动服务")
        self.assertEqual(stopped.linger_row.text(), "loginctl disable-linger gx")

    def test_service_install_ssh_prefixes(self) -> None:
        dialog = self._track(
            dialogs.ServiceInstallSheet(
                None,
                binary="/opt/chat-deepseek",
                data_dir="/srv/data",
                linger=False,
                username="gx",
                host="nas",
            )
        )
        self.assertTrue(
            dialog.linger_row.text().startswith("ssh -t nas ")
        )
        dialog.scope_field.setValue("system")
        self.assertTrue(dialog.install_row.text().startswith("ssh -t nas "))
        self.assertTrue(dialog.help_row.text().startswith("ssh nas "))

    def test_service_copy_button_resets_with_reset_ms(self) -> None:
        dialog = self._track(
            dialogs.ServiceInstallSheet(
                None,
                binary="/opt/chat-deepseek",
                data_dir="/srv/data",
                linger=False,
                username="gx",
                reset_ms=40,
            )
        )
        dialog.show()
        self.app.processEvents()
        dialog.linger_row.copy()
        self.assertEqual(dialog.linger_row.button.text(), "已复制")
        self.assertEqual(
            QGuiApplication.clipboard().text(),
            "loginctl enable-linger gx",
        )
        QTest.qWait(120)
        self.assertEqual(dialog.linger_row.button.text(), "复制")

    # -- 包导出 ------------------------------------------------------------

    def test_dialog_package_exports_page_facing_names(self) -> None:
        for name in (
            "ask_confirm",
            "show_message",
            "AccountForm",
            "PasswordForm",
            "GroupForm",
            "ServiceInstallSheet",
        ):
            self.assertTrue(hasattr(dialogs, name), name)
            self.assertIn(name, dialogs.__all__)


if __name__ == "__main__":
    unittest.main()
