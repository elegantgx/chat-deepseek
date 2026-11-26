"""UI 依赖的 controller 接口。

这里只描述类型，**不导入** `cdgui.controller`：C4 编排层和 C5 视图层可以并行
实现，窗口只依赖这个协议。方法名与 C4 的公共接口一一对应；参数只列 UI 需要
传入的事实（目标、表单值、选择），controller 自己负责拼命令和线程调度。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Protocol, runtime_checkable

from ..domain.state import AppState, PageId
from ..domain.target import Endpoint


class PumpProtocol(Protocol):
    """主线程回投泵；窗口用 30ms QTimer 调 ``drain()``。"""

    def drain(self) -> int | None:
        """执行当前排队的回调，返回执行条数（实现可返回 None）。"""




@runtime_checkable
class ControllerProtocol(Protocol):
    """C4 controller 的公共面；页面、顶栏和测试都只认这些方法。"""

    @property
    def state(self) -> AppState:
        """不可变状态快照；订阅回调里拿到的是同一个对象。"""

    @property
    def pump(self) -> PumpProtocol:
        """主线程回投队列；窗口定时 drain。"""

    def subscribe(self, listener: Callable[[AppState], None]) -> Callable[[], None]:
        """订阅状态变化，返回取消订阅函数。"""

    def set_page(self, page: PageId | str) -> None:
        """切换当前页；导航和快捷键的唯一入口。"""

    def dismiss_notice(self) -> None:
        """用户已经看到当前 notice；窗口展示后调用。"""

    # -- 登录 / 身份 -------------------------------------------------------

    def ensure_login(self, then: Callable[[], None] | None = None) -> bool:
        """需要登录时打开登录提示；已登录直接返回 True。"""

    def login(
        self,
        username: str,
        password: str,
        then: Callable[[], None] | None = None,
    ) -> None:
        """提交登录；错误通过 ``state.login.error`` 回投。"""

    def logout(self) -> None:
        """退出当前登录。"""

    # -- 账户 --------------------------------------------------------------

    def refresh_users(self) -> None:
        """重读账户列表。"""

    def select_user(self, username: str | None) -> None:
        """记录账户选择；按用户名，不按索引。"""

    def add_user(
        self,
        username: str,
        password: str,
        groups: Sequence[str] = (),
    ) -> None:
        """新增账户。"""

    def reset_password(self, username: str, password: str) -> None:
        """重置指定账户密码。"""

    def set_user_enabled(self, username: str, enabled: bool) -> None:
        """启用/禁用账户。"""

    def change_group(self, username: str, group: str, add: bool) -> None:
        """授予（add=True）或撤销一个组。"""

    def delete_user(self, username: str) -> None:
        """删除账户。"""

    # -- 备份 --------------------------------------------------------------

    def refresh_backups(self) -> None:
        """重读备份列表。"""

    def select_backup(self, name: str | None) -> None:
        """记录备份选择；按文件名。"""

    def backup_now(self) -> None:
        """备份到目标主机配置的备份目录。"""

    def backup_as(self, path: str) -> None:
        """备份到用户选择的本地路径（远端不提供）。"""

    def restore_backup(self, name: str) -> None:
        """恢复指定备份；调用方负责二次确认。"""

    # -- 服务 --------------------------------------------------------------

    def start_service(self) -> None:
        """启动服务（systemd 或前台会话）。"""

    def stop_service(self) -> None:
        """停止服务。"""

    def restart_service(self) -> None:
        """重启 systemd 服务。"""

    def install_service(self, options: dict[str, object]) -> None:
        """按选项安装 systemd 服务（scope/enable/start/force）。"""

    def update_service(self, options: dict[str, object]) -> None:
        """按选项更新 systemd 服务。"""

    def uninstall_service(self) -> None:
        """卸载 systemd 服务。"""

    # -- 设置 / 目标 -------------------------------------------------------

    def test_connection(self, endpoint: Endpoint) -> None:
        """用一次 ``info`` 测试连接。"""

    def apply_target(self, endpoint: Endpoint) -> None:
        """保存并切换到新的目标。"""

    def save_server_config(self, values: dict[str, str]) -> None:
        """逐项写入当前目标的服务端配置。"""

    def show_help(self) -> None:
        """展示 CLI 帮助。"""

    # -- 生命周期 ----------------------------------------------------------

    def shutdown(self) -> None:
        """关闭窗口时交给 controller 收尾（停前台、logout、关通道）。"""


__all__ = [
    "ControllerProtocol",
    "PumpProtocol",
]
