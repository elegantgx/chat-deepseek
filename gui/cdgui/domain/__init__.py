"""GUI 领域层。

- `target`：连接端点与冻结后的目标（本机 / SSH）
- `facts`：`info` 派生的服务端事实（HostConfig、ServiceStatus、前台会话）
- `state`：AppState 事实容器与不变量
- `reducers`：`(AppState, event) -> AppState` 纯函数
- `rules`：派生判断，所有“能不能点”的唯一出口
- `validation`：表单校验纯函数
- `commands`：CLI 参数构造（CommandSpec）

本包不导入 Qt，也不导入 `cdgui.infra` / `cdgui.ui`。
"""

from __future__ import annotations

from . import commands, facts, reducers, rules, state, target, validation

__all__ = [
    "commands",
    "facts",
    "reducers",
    "rules",
    "state",
    "target",
    "validation",
]
