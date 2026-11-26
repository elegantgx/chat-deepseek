"""C5a 控件层测试：构造、尺寸、tone、表单显隐与键盘操作。"""

from __future__ import annotations

import os
import sys
import time
import unittest
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication, QLineEdit, QWidget

import theme
from cdgui.ui import forms, palette, primitives, tokens


class UiPrimitivesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self) -> None:
        # 固定亮色主题，避免系统 gsettings 让断言随桌面变化。
        self._dark_hint = theme._dark_hint
        theme._dark_hint = False
        self.host = QWidget()

    def tearDown(self) -> None:
        theme._dark_hint = self._dark_hint
        self.host.close()
        self.host.deleteLater()
        self.app.processEvents()

    # -- tokens / palette --------------------------------------------------

    def test_tokens_expose_only_finite_scales(self) -> None:
        self.assertEqual(tokens.SPACING, (4, 8, 12, 16, 20, 24, 32))
        self.assertEqual(tokens.RADII, (8, 12, 18, 24, 32))
        self.assertEqual(tokens.FONT_SIZES, (11, 12, 13, 15, 22))
        self.assertEqual(tokens.HEIGHTS, (24, 28, 32, 36, 40, 60))
        self.assertEqual(tokens.MIN_WIDTHS, (32, 64, 72, 88, 96, 104, 260))
        for name, value in tokens.SIZE_ALIASES.items():
            self.assertIn(value, tokens.HEIGHTS, name)

    def test_tokens_reject_off_scale_values(self) -> None:
        self.assertEqual(tokens.space(16), 16)
        self.assertEqual(tokens.resolve_size("md"), 32)
        self.assertEqual(tokens.resolve_size(40), 40)
        with self.assertRaises(ValueError):
            tokens.space(13)
        with self.assertRaises(ValueError):
            tokens.resolve_size("huge")
        with self.assertRaises(ValueError):
            tokens.font(14)
        with self.assertRaises(ValueError):
            tokens.height(41)

    def test_palette_tone_mapping_comes_from_theme(self) -> None:
        foreground, background = palette.tone("success")
        self.assertEqual(foreground.name(), theme.color("success").name())
        self.assertEqual(background.name(), theme.color("success_soft").name())
        self.assertEqual(palette.tone("nope"), palette.tone("muted"))
        self.assertEqual(palette.tone_name("neutral"), "muted")
        self.assertEqual(palette.tone_name("info"), "primary")
        self.assertEqual(palette.on_accent().name(), theme.color("card").name())

    def test_palette_group_roles(self) -> None:
        self.assertEqual(palette.group_tone("Owner"), "primary")
        self.assertEqual(palette.group_tone("Admin"), "warning")
        self.assertEqual(palette.group_tone("User"), "muted")
        self.assertEqual(palette.group_tone("Other"), "muted")
        self.assertEqual(palette.GROUP_TONES["Owner"], "primary")

    # -- Surface / Badge ---------------------------------------------------

    def test_surface_kinds(self) -> None:
        card = primitives.Surface("card")
        panel = primitives.Surface("panel")
        self.assertEqual(card.kind, "card")
        self.assertEqual(panel.kind, "panel")
        self.assertEqual(card.body.spacing(), tokens.space(12))
        self.assertIn(theme.color("card").name(), card.styleSheet())
        self.assertIn(theme.color("card_alt").name(), panel.styleSheet())
        with self.assertRaises(ValueError):
            primitives.Surface("window")

    def test_badge_text_tone_and_dot(self) -> None:
        badge = primitives.Badge("运行中", tone="success")
        self.assertEqual(badge.text(), "运行中")
        self.assertEqual(badge.tone(), "success")
        self.assertEqual(badge.kind(), "soft")
        self.assertGreater(badge.sizeHint().width(), 0)
        self.assertEqual(badge.height(), tokens.height(24))

        badge.set_tone("danger")
        badge.setText("已停止")
        badge.set_dot(False)
        badge.set_kind("plain")
        self.assertEqual(badge.tone(), "danger")
        self.assertEqual(badge.text(), "已停止")
        self.assertEqual(badge.kind(), "plain")

        owner = primitives.Badge.group("Owner")
        self.assertEqual(owner.tone(), "primary")
        self.assertEqual(owner.text(), "Owner")

    def test_badge_and_avatar_do_not_take_focus(self) -> None:
        badge = primitives.Badge("Owner", tone="primary")
        avatar = primitives.Avatar("gx")
        self.assertEqual(badge.focusPolicy(), Qt.FocusPolicy.NoFocus)
        self.assertEqual(avatar.focusPolicy(), Qt.FocusPolicy.NoFocus)
        self.assertTrue(
            badge.testAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        )

    # -- Button ------------------------------------------------------------

    def test_button_size_heights(self) -> None:
        self.assertEqual(primitives.Button("保存", size="xs").height(), 24)
        self.assertEqual(primitives.Button("保存", size="sm").height(), 28)
        self.assertEqual(primitives.Button("保存", size="md").height(), 32)
        self.assertEqual(primitives.Button("保存", size="lg").height(), 36)
        self.assertEqual(primitives.Button("保存", size="xl").height(), 40)
        self.assertEqual(primitives.Button("保存", size=32).height(), 32)
        self.assertEqual(primitives.Button("保存", size=40).height(), 40)
        with self.assertRaises(ValueError):
            primitives.Button("保存", size=38)
        with self.assertRaises(ValueError):
            primitives.Button("保存", kind="window")

    def test_button_factory_and_size_hint(self) -> None:
        action = primitives.button("打开页面", "secondary", size="lg")
        self.assertIsInstance(action, primitives.Button)
        self.assertEqual(action.height(), tokens.height(36))
        self.assertGreaterEqual(action.sizeHint().width(), action.fontMetrics().horizontalAdvance("打开页面"))
        self.assertEqual(
            action.focusPolicy(), Qt.FocusPolicy.StrongFocus
        )

    # -- Field -------------------------------------------------------------

    def test_field_text_password_and_return_pressed(self) -> None:
        field = primitives.Field(text="secret", placeholder="请输入", password=True)
        self.assertEqual(field.text(), "secret")
        self.assertEqual(field.edit.echoMode(), QLineEdit.EchoMode.Password)
        field.setEchoMode(QLineEdit.EchoMode.Normal)
        self.assertEqual(field.edit.echoMode(), QLineEdit.EchoMode.Normal)
        field.setPlaceholderText("新的占位")
        self.assertEqual(field.edit.placeholderText(), "新的占位")
        field.setEchoMode(QLineEdit.EchoMode.Password)

        hits: list[int] = []
        field.returnPressed.connect(lambda: hits.append(1))
        QTest.keyClick(field.edit, Qt.Key.Key_Return)
        self.assertEqual(hits, [1])

    def test_field_readonly_is_selectable(self) -> None:
        field = primitives.Field(kind="readonly", text="可复制的值")
        self.assertTrue(field.edit.isReadOnly())
        self.assertTrue(field.isEnabled())
        field.setText("新值")
        field.edit.setSelection(0, 2)
        self.assertEqual(field.edit.selectedText(), "新值")
        self.assertEqual(field.value(), "新值")

    def test_field_select_value_and_label(self) -> None:
        field = primitives.Field(
            kind="select",
            options=[("local", "本机"), ("ssh", "SSH 远程")],
        )
        self.assertEqual(field.value(), "local")
        self.assertEqual(field.text(), "本机")
        self.assertIsNone(field.edit)
        changed: list[str] = []
        field.changed.connect(changed.append)
        field.setValue("ssh")
        self.assertEqual(field.value(), "ssh")
        self.assertEqual(field.label(), "SSH 远程")
        self.assertEqual(changed, ["ssh"])
        field.setValue("missing")
        self.assertEqual(field.value(), "ssh")
        field.setText("本机")
        self.assertEqual(field.value(), "local")

    def test_field_form_modes(self) -> None:
        field = primitives.Field(text="x")
        field.set_form_mode("readonly")
        self.assertTrue(field.edit.isReadOnly())
        self.assertTrue(field.isEnabled())
        field.set_form_mode("edit")
        self.assertFalse(field.edit.isReadOnly())
        field.set_form_mode("disabled")
        self.assertFalse(field.isEnabled())
        with self.assertRaises(ValueError):
            field.set_form_mode("locked")

        select = primitives.Field(kind="select", options=[("a", "A")])
        select.set_form_mode("readonly")
        self.assertFalse(select.combo.isEnabled())
        self.assertTrue(select.isEnabled())
        select.set_form_mode("edit")
        self.assertTrue(select.combo.isEnabled())
        select.set_form_mode("disabled")
        self.assertFalse(select.isEnabled())

    # -- Switch / Choice ---------------------------------------------------

    def test_switch_and_switch_row(self) -> None:
        switch = primitives.Switch()
        self.assertFalse(switch.isChecked())
        switch.click()
        self.assertTrue(switch.isChecked())
        self.assertEqual(switch.height(), tokens.height(24))

        row = primitives.SwitchRow("启动后打开页面", checked=True)
        self.assertTrue(row.isChecked())
        row.setChecked(False)
        self.assertFalse(row.isChecked())
        self.assertEqual(row.text(), "启动后打开页面")

    def test_choice_check_and_row(self) -> None:
        check = primitives.Choice("记住我", kind="check", checked=False)
        self.assertFalse(check.isChecked())
        check.click()
        self.assertTrue(check.isChecked())
        self.assertEqual(check.height(), tokens.height(24))

        row = primitives.Choice("选择这个组", kind="row")
        self.assertEqual(row.height(), tokens.height(40))
        row.setChecked(True)
        self.assertTrue(row.isChecked())
        with self.assertRaises(ValueError):
            primitives.Choice(kind="toggle")

    # -- Avatar / ListRow --------------------------------------------------

    def test_avatar_sizes(self) -> None:
        avatar = primitives.Avatar("gx", size="sm")
        self.assertEqual(avatar.width(), 28)
        self.assertEqual(avatar.width(), avatar.height())
        avatar.set_username("alice")
        self.assertEqual(avatar.username(), "alice")
        avatar.set_selected(True)
        self.assertTrue(avatar.is_selected())

    def test_list_row_keyboard_selection(self) -> None:
        row = primitives.ListRow("gx", "Owner", key="gx")
        row.show()
        row.setFocus()
        self.app.processEvents()

        toggled: list[bool] = []
        row.toggled.connect(toggled.append)
        QTest.keyClick(row, Qt.Key.Key_Space)
        self.assertTrue(row.is_selected())
        self.assertEqual(toggled, [True])
        QTest.keyClick(row, Qt.Key.Key_Space)
        self.assertFalse(row.is_selected())
        self.assertEqual(toggled, [True, False])

    def test_list_row_navigation_signals(self) -> None:
        row = primitives.ListRow("备份", "2026-11-26")
        row.show()
        row.setFocus()
        self.app.processEvents()
        seen: list[str] = []
        row.upPressed.connect(lambda: seen.append("up"))
        row.downPressed.connect(lambda: seen.append("down"))
        row.activated.connect(lambda: seen.append("enter"))
        row.clicked.connect(lambda: seen.append("click"))
        QTest.keyClick(row, Qt.Key.Key_Up)
        QTest.keyClick(row, Qt.Key.Key_Down)
        QTest.keyClick(row, Qt.Key.Key_Return)
        self.assertEqual(seen, ["up", "down", "enter"])
        self.assertEqual(row.key, "备份")

    def test_list_row_avatar_selection_and_accessible_name(self) -> None:
        avatar = primitives.Avatar("gx")
        row = primitives.ListRow("gx", "Owner", avatar=avatar)
        self.assertIn("gx", row.accessibleName())
        self.assertIn("Owner", row.accessibleName())
        row.set_selected(True)
        self.assertTrue(avatar.is_selected())

    # -- Heading / Toast / glyphs -----------------------------------------

    def test_section_heading_and_toast(self) -> None:
        heading = primitives.SectionHeading("服务")
        self.assertEqual(heading.text(), "服务")
        heading.add(primitives.Badge("3", tone="muted"))
        heading.setText("账户")
        self.assertEqual(heading.text(), "账户")

        self.host.show()
        toast = primitives.Toast(self.host)
        toast.show_message("已保存")
        self.app.processEvents()
        self.assertEqual(toast.text(), "已保存")
        self.assertTrue(toast.isVisible())
        self.assertIn(theme.color("success_soft").name(), toast.styleSheet())
        toast.show_message("失败了", error=True)
        self.assertIn(theme.color("danger_soft").name(), toast.styleSheet())
        toast.hide()

    def test_brand_logo_and_lock_glyph(self) -> None:
        logo = primitives.BrandLogo()
        glyph = primitives.LockGlyph()
        self.assertEqual(logo.width(), tokens.height(40))
        self.assertEqual(glyph.width(), tokens.height(40))
        self.assertEqual(logo.focusPolicy(), Qt.FocusPolicy.NoFocus)
        self.assertEqual(glyph.focusPolicy(), Qt.FocusPolicy.NoFocus)

    # -- forms -------------------------------------------------------------

    def test_form_row_modes(self) -> None:
        field = primitives.Field(text="路径")
        row = forms.FormRow("二进制目录", field, hint="提示")
        self.assertEqual(row.mode(), "edit")
        row.set_mode("readonly")
        self.assertTrue(field.edit.isReadOnly())
        self.assertTrue(field.isEnabled())
        row.set_mode("disabled")
        self.assertFalse(field.isEnabled())
        row.set_mode("edit")
        self.assertFalse(field.edit.isReadOnly())
        self.assertTrue(field.isEnabled())
        with self.assertRaises(ValueError):
            row.set_mode("locked")

    def test_form_grid_hidden_row_takes_no_space(self) -> None:
        grid = forms.FormGrid()
        first = forms.FormRow("第一项", primitives.Field(text="1"))
        second = forms.FormRow("第二项", primitives.Field(text="2"))
        grid.add(first, key="first")
        grid.add(second, key="second")
        grid.show()
        self.app.processEvents()
        before = grid.sizeHint().height()
        grid.set_visible("second", False)
        self.app.processEvents()
        self.assertTrue(second.isHidden())
        self.assertLess(grid.sizeHint().height(), before)
        self.assertEqual(grid.values(), {"first": "1", "second": "2"})
        self.assertEqual(grid.values(visible_only=True), {"first": "1"})
        grid.set_visible(["second"], True)
        self.assertFalse(second.isHidden())

    def test_form_grid_read_only_and_duplicate_keys(self) -> None:
        grid = forms.FormGrid()
        row = forms.FormRow("监听地址", primitives.Field(text="127.0.0.1:8090"))
        grid.add(row, key="listen")
        grid.set_read_only(["listen"], True)
        self.assertEqual(row.mode(), "readonly")
        self.assertTrue(row.control.edit.isReadOnly())
        grid.set_read_only("listen", False)
        self.assertEqual(row.mode(), "edit")
        with self.assertRaises(ValueError):
            grid.add(forms.FormRow("重复", primitives.Field()), key="listen")

    def test_path_row_browse(self) -> None:
        row = forms.PathRow(text="/old", placeholder="选择路径")
        self.assertEqual(row.text(), "/old")
        calls: list[forms.PathRow] = []

        def browse(parent):
            calls.append(parent)
            return "/new"

        row.set_browse_handler(browse)
        row.browse_button.click()
        self.assertEqual(row.text(), "/new")
        self.assertEqual(row.value(), "/new")
        self.assertEqual(len(calls), 1)
        row.set_form_mode("readonly")
        self.assertTrue(row.field.edit.isReadOnly())
        self.assertFalse(row.browse_button.isEnabled())

    def test_copy_row_resets_after_reset_ms(self) -> None:
        row = forms.CopyRow("安装命令", value="chat-deepseek service install", reset_ms=50)
        row.copy()
        self.assertEqual(row.button.text(), "已复制")
        self.assertEqual(row.value(), "chat-deepseek service install")
        self.assertEqual(
            QGuiApplication.clipboard().text(), "chat-deepseek service install"
        )
        deadline = time.monotonic() + 2.0
        while row.button.text() != "复制" and time.monotonic() < deadline:
            QTest.qWait(20)
        self.assertEqual(row.button.text(), "复制")
        self.assertEqual(row.field.text(), "chat-deepseek service install")

    def test_copy_row_button_and_modes(self) -> None:
        row = forms.CopyRow(value="value", reset_ms=50)
        row.button.click()
        self.assertEqual(row.button.text(), "已复制")
        row.set_mode("disabled")
        self.assertFalse(row.button.isEnabled())
        row.set_mode("readonly")
        self.assertTrue(row.button.isEnabled())
        self.assertTrue(row.field.edit.isReadOnly())

    def test_danger_row_click_and_mode(self) -> None:
        row = forms.DangerRow("危险操作", text="删除账户")
        hits: list[int] = []
        row.clicked.connect(lambda: hits.append(1))
        row.button.click()
        self.assertEqual(hits, [1])
        row.set_mode("readonly")
        self.assertFalse(row.button.isEnabled())
        row.set_mode("disabled")
        self.assertFalse(row.button.isEnabled())

    # -- 结构与约束 --------------------------------------------------------

    def test_all_controls_construct(self) -> None:
        widgets = [
            primitives.Surface(),
            primitives.Surface("panel"),
            primitives.Badge("标签"),
            primitives.Button("按钮"),
            primitives.Field(),
            primitives.Field(kind="readonly"),
            primitives.Field(kind="select", options=[("a", "A")]),
            primitives.Switch(),
            primitives.SwitchRow("开关"),
            primitives.Choice("勾选"),
            primitives.Choice("选项", kind="row"),
            primitives.Avatar("gx"),
            primitives.ListRow("标题", "副标题"),
            primitives.SectionHeading("标题"),
            primitives.Toast(self.host),
            primitives.BrandLogo(),
            primitives.LockGlyph(),
            forms.PathRow(),
            forms.CopyRow("复制", value="x"),
            forms.DangerRow("危险", text="删除"),
            forms.FormGrid(),
        ]
        for widget in widgets:
            self.assertIsInstance(widget, QWidget)
            widget.deleteLater()
        self.app.processEvents()

    def test_paint_event_budget_is_nine_or_less(self) -> None:
        classes = [
            primitives.Surface,
            primitives.Badge,
            primitives.Button,
            primitives.Field,
            primitives.Switch,
            primitives.SwitchRow,
            primitives.Choice,
            primitives.Avatar,
            primitives.ListRow,
            primitives.SectionHeading,
            primitives.Toast,
            primitives.BrandLogo,
            primitives.LockGlyph,
        ]
        painted = [cls.__name__ for cls in classes if "paintEvent" in vars(cls)]
        self.assertLessEqual(len(painted), 9, painted)
        self.assertEqual(len(painted), 8, painted)

    def test_ui_layer_has_no_domain_or_infra_imports(self) -> None:
        ui_dir = Path(primitives.__file__).resolve().parent
        for path in ui_dir.rglob("*.py"):
            source = path.read_text(encoding="utf-8")
            self.assertNotIn("cdgui.domain", source, path.name)
            self.assertNotIn("cdgui.infra", source, path.name)



if __name__ == "__main__":
    unittest.main()
