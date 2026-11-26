"""CLI 网关：参数由 domain.commands 构造，执行交给 transport。

界面/编排层只调用这里的方法，拿到解析好的领域对象；错误一律是
`CommandError`（已归一化，含可直接展示的 `failure`）。这里的每个方法都是
“构造 CommandSpec → transport.run → normalize”，不再自己拼 argv。
"""

from __future__ import annotations

from collections.abc import Sequence

import parsing

from ..domain import commands
from ..domain.commands import CommandSpec
from ..domain.target import Target
from .errors import normalize
from .process import CancelCheck
from .serve import ServeHandle
from .transport import Transport


class CliGateway:
    """一个目标一个网关；目标切换时由 controller 重建 transport + gateway。"""

    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    @property
    def target(self) -> Target:
        return self._transport.target

    @property
    def transport(self) -> Transport:
        return self._transport

    # ---- 读取 ---------------------------------------------------------

    def info(self, cancel: CancelCheck | None = None) -> parsing.Info:
        return self._run(commands.info(self.target), parsing.parse_info, cancel)

    def whoami(self, cancel: CancelCheck | None = None) -> parsing.Identity:
        return self._run(commands.whoami(self.target), parsing.parse_whoami, cancel)

    def users(self, cancel: CancelCheck | None = None) -> list[parsing.User]:
        return self._run(commands.user_list(self.target), parsing.parse_users, cancel)

    # 别名：旧代码/口语里常叫 user_list。
    def user_list(self, cancel: CancelCheck | None = None) -> list[parsing.User]:
        return self.users(cancel)

    def backups(self, cancel: CancelCheck | None = None) -> list[parsing.Backup]:
        return self._run(
            commands.backup_list(self.target), parsing.parse_backup_list, cancel
        )

    # 方法名列表里同时要求 backups 与 backup_list；后者是前者的别名。
    def backup_list(self, cancel: CancelCheck | None = None) -> list[parsing.Backup]:
        return self.backups(cancel)

    def help(self, cancel: CancelCheck | None = None) -> str:
        result = self._run(commands.help_command(self.target), None, cancel)
        return result.stdout

    # ---- 登录态 -------------------------------------------------------

    def login(
        self,
        username: str,
        password: str,
        cancel: CancelCheck | None = None,
    ) -> None:
        self._run(commands.login(self.target, username, password), None, cancel)

    def logout(self, cancel: CancelCheck | None = None) -> None:
        self._run(commands.logout(self.target), None, cancel)

    # ---- 账户 ---------------------------------------------------------

    def user_add(
        self,
        username: str,
        password: str,
        groups: Sequence[str] = (),
        cancel: CancelCheck | None = None,
    ) -> None:
        self._run(
            commands.user_add(self.target, username, password, groups),
            None,
            cancel,
        )

    def user_reset_password(
        self,
        username: str,
        password: str,
        cancel: CancelCheck | None = None,
    ) -> None:
        self._run(
            commands.user_reset_password(self.target, username, password),
            None,
            cancel,
        )

    def user_enable(
        self,
        username: str,
        *,
        enabled: bool = True,
        cancel: CancelCheck | None = None,
    ) -> None:
        """`enabled=False` 走 disable；账户列表的“启用/禁用”共用一个入口。"""
        spec = (
            commands.user_enable(self.target, username)
            if enabled
            else commands.user_disable(self.target, username)
        )
        self._run(spec, None, cancel)

    def user_delete(
        self, username: str, cancel: CancelCheck | None = None
    ) -> None:
        self._run(commands.user_delete(self.target, username), None, cancel)

    def user_grant(
        self,
        username: str,
        group: str,
        cancel: CancelCheck | None = None,
    ) -> None:
        self._run(
            commands.user_grant(self.target, username, group), None, cancel
        )

    def user_revoke(
        self,
        username: str,
        group: str,
        cancel: CancelCheck | None = None,
    ) -> None:
        self._run(
            commands.user_revoke(self.target, username, group), None, cancel
        )

    # ---- 备份 ---------------------------------------------------------

    def backup_create(
        self, output: str | None = None, cancel: CancelCheck | None = None
    ) -> str | None:
        """立即备份（可指定输出路径），返回 `备份已写入 <path>` 里的路径。"""
        spec = (
            commands.backup_now(self.target)
            if output is None
            else commands.backup_as(self.target, output)
        )
        return self._run(spec, parsing.parse_backup_path, cancel)

    def backup_restore(
        self, name: str, cancel: CancelCheck | None = None
    ) -> None:
        self._run(commands.backup_restore(self.target, name), None, cancel)

    # ---- 服务 / 配置 --------------------------------------------------

    def service(
        self,
        action: str,
        *,
        enable: bool = False,
        force: bool = False,
        cancel: CancelCheck | None = None,
    ) -> None:
        self._run(
            commands.service_cmd(
                self.target, action, enable=enable, force=force
            ),
            None,
            cancel,
        )

    def config_set(
        self, key: str, value: str, cancel: CancelCheck | None = None
    ) -> None:
        self._run(commands.config_set(self.target, key, value), None, cancel)

    # ---- 前台会话 -----------------------------------------------------

    def serve(
        self,
        *,
        on_line=None,
        on_exit=None,
    ) -> ServeHandle:
        """启动前台 serve；返回已启动的 handle，日志经回调交给 pump。"""
        return self._transport.open_serve(
            commands.serve(self.target),
            on_line=on_line,
            on_exit=on_exit,
        )

    def verify(self, timeout: float = 20.0) -> None:
        self._transport.verify(timeout)

    def close(self) -> None:
        self._transport.close()

    # ---- 内部 ---------------------------------------------------------

    def _run(self, spec: CommandSpec, parse, cancel: CancelCheck | None):
        result = self._transport.run(spec, cancel)
        return normalize(result, target=self.target, parse=parse)
