"""AppState 的全部 reducer，纯函数：`(state, ...) -> new_state`。

约定：
- 绝不原地修改 `state` 或其中容器；
- 关闭之后到达的 I/O 结果一律丢弃（`closing_started` 自己除外）；
- 参数是非法的编程错误时抛 `ValueError`，不静默修正；用户输入错误走
  `validation.py`。
"""

from __future__ import annotations

from dataclasses import replace
from typing import Mapping, Sequence

import parsing

from .facts import ForegroundPhase, ForegroundSession, HostConfig
from .state import (
    AppState,
    InflightEntry,
    LoginPrompt,
    Notice,
    NoticeTone,
    PageId,
    Phase,
    TaskKey,
)
from .target import Target


def _frozen(state: AppState) -> bool:
    """关闭阶段不再让任何回调落地。"""
    return state.closing or state.phase is Phase.CLOSING


def _drop_inflight(
    state: AppState, task: TaskKey
) -> Mapping[TaskKey, InflightEntry]:
    if task not in state.inflight:
        return state.inflight
    return {key: entry for key, entry in state.inflight.items() if key is not task}


def set_page(state: AppState, page: PageId | str) -> AppState:
    """导航事实；页面选择与 target 无关，切目标不自动跳页。"""
    if _frozen(state):
        return state
    value = PageId(page)
    if value is state.page:
        return state
    return replace(state, page=value)


def booted(state: AppState) -> AppState:
    """启动阶段结束：允许页面渲染并开始发命令。"""
    if _frozen(state):
        return state
    if state.phase is Phase.READY:
        return state
    return replace(state, phase=Phase.READY)


def target_changed(state: AppState, target: Target) -> AppState:
    """切换目标：旧目标的事实全部作废，页面保持不动。

    旧前台会话必须先由 controller 停掉；这里只负责让它的状态不再可见。
    """
    if _frozen(state):
        return state
    if target.key == state.target.key:
        return state
    return replace(
        state,
        target=target,
        hosts={},
        identity=None,
        users=(),
        backups=(),
        selected=None,
        selected_backup=None,
        foreground=None,
        inflight={},
        login=None,
        notice=None,
        info_error=None,
    )


def facts_loaded(state: AppState, host: HostConfig) -> AppState:
    """`info` 成功；只接受当前 target 的快照，整块替换。"""
    if _frozen(state):
        return state
    if host.target_key != state.target.key:
        raise ValueError(
            f"info 属于 {host.target_key!r}，当前目标是 {state.target.key!r}"
        )
    return replace(
        state,
        hosts={state.target.key: host},
        info_error=None,
    )


def facts_failed(
    state: AppState,
    failure: str | parsing.Failure = "",
    details: str = "",
    *,
    tone: NoticeTone = NoticeTone.ERROR,
) -> AppState:
    """`info` 失败：保留上一份 HostConfig，只清掉 INFO 任务并提示。

    接受 `parsing.Failure` 或已经拼好的文案，省得 controller 两头转换。
    """
    if _frozen(state):
        return state
    inflight = _drop_inflight(state, TaskKey.INFO)
    if isinstance(failure, parsing.Failure):
        message = failure.message or failure.title
        details = details or (failure.details or "")
    else:
        message = failure
    info_error = message or "无法读取服务状态"
    notice = (
        Notice(text=info_error, tone=NoticeTone(tone), details=details)
        if (message or details)
        else state.notice
    )
    if (
        inflight is state.inflight
        and notice is state.notice
        and state.info_error == info_error
    ):
        return state
    return replace(
        state,
        inflight=inflight,
        notice=notice,
        info_error=info_error,
    )


def identity_loaded(state: AppState, identity: parsing.Identity) -> AppState:
    """`whoami` 成功；换人时清掉上一身份的列表与选中。"""
    if _frozen(state):
        return state
    changed_user = (
        state.identity is None or state.identity.username != identity.username
    )
    changes: dict[str, object] = {"identity": identity, "login": None}
    if changed_user:
        changes.update(
            users=(), backups=(), selected=None, selected_backup=None
        )
    return replace(state, **changes)


def auth_expired(
    state: AppState, message: str = "登录已过期，请重新登录"
) -> AppState:
    """唯一清登录态出口：身份、列表、选中和在途任务一起作废。"""
    if _frozen(state):
        return state
    return replace(
        state,
        identity=None,
        users=(),
        backups=(),
        selected=None,
        selected_backup=None,
        inflight={},
        login=None,
        notice=Notice(text=message, tone=NoticeTone.ERROR),
    )


def users_loaded(state: AppState, users: Sequence[parsing.User]) -> AppState:
    """`user list` 成功；选中账户按用户名保留，不存在则清空。"""
    if _frozen(state):
        return state
    values = tuple(users)
    selected = state.selected
    if selected is not None and selected not in {
        user.username for user in values
    }:
        selected = None
    return replace(state, users=values, selected=selected)


def backups_loaded(state: AppState, backups: Sequence[parsing.Backup]) -> AppState:
    """`backup list` 成功；已选备份不存在时清空。"""
    if _frozen(state):
        return state
    values = tuple(backups)
    names = {item.name for item in values}
    selected_backup = state.selected_backup
    if selected_backup is not None and selected_backup not in names:
        selected_backup = None
    return replace(
        state, backups=values, selected_backup=selected_backup
    )


def select_user(state: AppState, username: str | None) -> AppState:
    """选中/取消选中账户；未知用户名是编程错误。"""
    if _frozen(state):
        return state
    if username is None:
        return state if state.selected is None else replace(state, selected=None)
    names = {user.username for user in state.users}
    if username not in names:
        raise ValueError(f"没有这个账户：{username}")
    if state.selected == username:
        return state
    return replace(state, selected=username)


def select_backup(state: AppState, name: str | None) -> AppState:
    """选中/取消选中备份；未知备份名是编程错误。"""
    if _frozen(state):
        return state
    if name is None:
        return (
            state
            if state.selected_backup is None
            else replace(state, selected_backup=None)
        )
    names = {item.name for item in state.backups}
    if name not in names:
        raise ValueError(f"没有这个备份：{name}")
    if state.selected_backup == name:
        return state
    return replace(state, selected_backup=name)


def task_started(
    state: AppState,
    task: TaskKey | str,
    *,
    target_key: str | None = None,
    generation: int = 1,
) -> AppState:
    """登记一个在途任务；同一 TaskKey 不允许重复。"""
    if _frozen(state):
        return state
    key = TaskKey(task)
    if key in state.inflight:
        raise ValueError(f"任务已在执行：{key.value}")
    owner = state.target.key if target_key is None else target_key
    if owner != state.target.key:
        raise ValueError("任务目标与当前 target 不一致")
    if generation < 1:
        raise ValueError("generation 必须 ≥ 1")
    entry = InflightEntry(task_key=key, target_key=owner, generation=generation)
    inflight = dict(state.inflight)
    inflight[key] = entry
    return replace(state, inflight=inflight)


def task_finished(state: AppState, task: TaskKey | str) -> AppState:
    """任务结束；迟到/重复的结束是幂等的。"""
    if _frozen(state):
        return state
    key = TaskKey(task)
    inflight = _drop_inflight(state, key)
    if inflight is state.inflight:
        return state
    return replace(state, inflight=inflight)


def login_prompt_set(
    state: AppState, prompt: LoginPrompt | None
) -> AppState:
    if _frozen(state):
        return state
    if prompt is state.login:
        return state
    return replace(state, login=prompt)


def notice_raised(
    state: AppState,
    notice: Notice | str,
    *,
    tone: NoticeTone = NoticeTone.INFO,
    details: str = "",
) -> AppState:
    """弹一次提示；关闭后抑制。"""
    if _frozen(state):
        return state
    value = notice if isinstance(notice, Notice) else Notice(
        text=str(notice), tone=NoticeTone(tone), details=details
    )
    return replace(state, notice=value)


def notice_dismissed(state: AppState) -> AppState:
    """清掉已展示的提示；关闭时也允许，方便窗口收尾。"""
    if state.notice is None:
        return state
    return replace(state, notice=None)


def foreground_updated(
    state: AppState, foreground: ForegroundSession | None
) -> AppState:
    """前台 `serve` 会话变化；只接受当前目标，并裁掉 40 行以外的日志。"""
    if _frozen(state):
        return state
    if foreground is None:
        if state.foreground is None:
            return state
        return replace(state, foreground=None)
    if foreground.target_key != state.target.key:
        raise ValueError("前台会话不属于当前目标")
    phase = foreground.phase
    if not isinstance(phase, ForegroundPhase):
        foreground = replace(foreground, phase=ForegroundPhase(phase))
    if len(foreground.tail) > 40:
        foreground = foreground.with_tail(foreground.tail)
    return replace(state, foreground=foreground)


def closing_started(state: AppState) -> AppState:
    """进入关闭阶段；之后所有 I/O reducer 都返回原状态。"""
    if state.closing and state.phase is Phase.CLOSING:
        return state
    return replace(
        state,
        closing=True,
        phase=Phase.CLOSING,
        login=None,
        notice=None,
    )
