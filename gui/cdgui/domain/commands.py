"""CLI 参数构造。

argv 顺序以 `BEHAVIOR_BASELINE.md` §2 为契约；密码只放 `stdin`，永远不进 argv。
超时：`backup*` 1800s，`info` / `login` / `whoami` 20s，其余 120s（与基线一致；
计划 §5.3 提到的 kill 5s 与基线“其余 120s”冲突，这里按基线取 120s）。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .target import Target

TIMEOUT_DEFAULT = 120.0
TIMEOUT_BACKUP = 1800.0
TIMEOUT_QUICK = 20.0
TIMEOUT_KILL = 5.0


@dataclass(frozen=True)
class CommandSpec:
    argv: tuple[str, ...]
    stdin: str | None = None
    timeout: float = TIMEOUT_DEFAULT


def _data_args(target: Target) -> tuple[str, ...]:
    # 远端 data_dir 为空表示用远端 CLI 默认值；本机在 resolve_target 已展开 ~。
    if not target.data_dir:
        return ()
    return ("--data-dir", target.data_dir)


def _password_stdin(password: str) -> str:
    return password + "\n"


def login(target: Target, username: str, password: str) -> CommandSpec:
    return CommandSpec(
        (
            "login",
            "--username",
            username,
            "--password-stdin",
            *_data_args(target),
        ),
        _password_stdin(password),
        TIMEOUT_QUICK,
    )


def whoami(target: Target) -> CommandSpec:
    return CommandSpec(("whoami", *_data_args(target)), None, TIMEOUT_QUICK)


def logout(target: Target) -> CommandSpec:
    return CommandSpec(("logout", *_data_args(target)))


def setup(
    target: Target, username: str, password: str, *, listen: str = ""
) -> CommandSpec:
    extra = ("--listen", listen) if listen else ()
    return CommandSpec(
        (
            "setup",
            "--username",
            username,
            "--password-stdin",
            *_data_args(target),
            *extra,
        ),
        _password_stdin(password),
    )


def user_list(target: Target) -> CommandSpec:
    return CommandSpec(("user", "list", *_data_args(target)))


def user_add(
    target: Target,
    username: str,
    password: str,
    groups: Sequence[str] = (),
) -> CommandSpec:
    argv: list[str] = ["user", "add", *_data_args(target)]
    for group in groups:
        argv.extend(("--group", group))
    argv.extend(("--password-stdin", username))
    return CommandSpec(tuple(argv), _password_stdin(password))


def user_reset_password(
    target: Target, username: str, password: str
) -> CommandSpec:
    return CommandSpec(
        (
            "user",
            "reset-password",
            *_data_args(target),
            "--password-stdin",
            username,
        ),
        _password_stdin(password),
    )


def user_enable(target: Target, username: str) -> CommandSpec:
    return CommandSpec(("user", "enable", *_data_args(target), username))


def user_disable(target: Target, username: str) -> CommandSpec:
    return CommandSpec(("user", "disable", *_data_args(target), username))


def user_toggle(target: Target, username: str, *, disabled: bool) -> CommandSpec:
    """`disabled` 是账户当前状态：禁用中的账户要执行 enable。"""
    return user_enable(target, username) if disabled else user_disable(
        target, username
    )


def user_grant(target: Target, username: str, group: str) -> CommandSpec:
    return CommandSpec(
        ("user", "grant", *_data_args(target), username, group)
    )


def user_revoke(target: Target, username: str, group: str) -> CommandSpec:
    return CommandSpec(
        ("user", "revoke", *_data_args(target), username, group)
    )


def user_delete(target: Target, username: str) -> CommandSpec:
    return CommandSpec(
        ("user", "delete", *_data_args(target), "--yes", username)
    )


def backup_now(target: Target) -> CommandSpec:
    return CommandSpec(("backup", *_data_args(target)), None, TIMEOUT_BACKUP)


def backup_as(target: Target, output: str) -> CommandSpec:
    return CommandSpec(
        ("backup", "--output", output, *_data_args(target)),
        None,
        TIMEOUT_BACKUP,
    )


def backup_list(target: Target) -> CommandSpec:
    return CommandSpec(
        ("backup", "list", *_data_args(target)), None, TIMEOUT_BACKUP
    )


def backup_restore(target: Target, name: str) -> CommandSpec:
    return CommandSpec(
        ("backup", "restore", "--yes", *_data_args(target), name),
        None,
        TIMEOUT_BACKUP,
    )


def info(target: Target) -> CommandSpec:
    return CommandSpec(("info", *_data_args(target)), None, TIMEOUT_QUICK)


def test_connection(target: Target) -> CommandSpec:
    """设置页“测试连接”就是一次 `info`（同样的 20s 快速超时）。"""
    return info(target)


def config_set(target: Target, key: str, value: str) -> CommandSpec:
    return CommandSpec(
        ("config", "set", key, value, *_data_args(target))
    )


def serve(target: Target) -> CommandSpec:
    return CommandSpec(("serve", "--no-browser", *_data_args(target)))


def service_install(
    target: Target, *, enable: bool = False, force: bool = False
) -> CommandSpec:
    argv: list[str] = ["service", "install"]
    if enable:
        argv.append("--enable")
    if force:
        argv.append("--force")
    argv.extend(("--data-dir", _service_data_dir(target)))
    return CommandSpec(tuple(argv))


def service_cmd(
    target: Target,
    action: str,
    *,
    enable: bool = False,
    force: bool = False,
) -> CommandSpec:
    """按动作拼 `service` 命令，供 C3 的 transport/controller 统一入口使用。"""
    if action == "install":
        return service_install(target, enable=enable, force=force)
    if action == "update":
        return service_update(target, enable=enable)
    if action == "start":
        return service_start(target)
    if action == "stop":
        return service_stop(target)
    if action == "restart":
        return service_restart(target)
    if action == "uninstall":
        return service_uninstall(target)
    raise ValueError(f"未知的 service 动作：{action}")



def service_update(target: Target, *, enable: bool) -> CommandSpec:
    """更新必须显式 `--enable` / `--disable`，不能依赖缓存的开关状态。"""
    argv = ["service", "install", "--enable" if enable else "--disable", "--force"]
    argv.extend(("--data-dir", _service_data_dir(target)))
    return CommandSpec(tuple(argv))


def service_start(target: Target) -> CommandSpec:
    return CommandSpec(("service", "start"))


def service_stop(target: Target) -> CommandSpec:
    return CommandSpec(("service", "stop"))


def service_restart(target: Target) -> CommandSpec:
    return CommandSpec(("service", "restart"))


def service_uninstall(target: Target) -> CommandSpec:
    return CommandSpec(("service", "uninstall"))


def _service_data_dir(target: Target) -> str:
    # 安装/更新必须显式指定数据目录；远端留空时不允许拼出空参数。
    if not target.data_dir:
        raise ValueError("安装 systemd 服务前需要目标数据目录")
    return target.data_dir


def kill_serve(pid: int) -> CommandSpec:
    """远端前台会话的停止命令（经常驻 SSH 通道执行，最多等 5s）。"""
    return CommandSpec(("kill", "-TERM", str(pid)), None, TIMEOUT_KILL)


def help_command(target: Target) -> CommandSpec:
    return CommandSpec(("help",))
