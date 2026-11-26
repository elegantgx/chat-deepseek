"""单一只读状态容器：controller 写、视图订阅。

`Store` 不导入 Qt，也不认识任何 I/O；它只保证三件事：

1. reducer 永远是纯函数，产出新 `AppState`；
2. 新状态先过 `assert_invariants`，失败时不改变旧状态（编程错误直接抛出）；
3. 状态变化后通知全部订阅者，窗口据此“单一渲染”。

`update` 是同步的，必须在主线程调用；异步线程只能把回调投给 `QueuePump`。
"""

from __future__ import annotations

from typing import Callable

from .domain.state import AppState, assert_invariants

Listener = Callable[[AppState], None]


class Store:
    """保存唯一一份 `AppState`，并向外提供订阅。"""

    def __init__(self, state: AppState) -> None:
        assert_invariants(state)
        self._state = state
        self._listeners: list[Listener] = []

    @property
    def state(self) -> AppState:
        return self._state

    def update(self, reducer: Callable[[AppState], AppState]) -> None:
        """应用一个 reducer：先校验不变量，成功后才替换并通知。"""
        new_state = reducer(self._state)
        assert_invariants(new_state)
        self._state = new_state
        # 复制一份再遍历：订阅者在回调里退订/新增不会影响本轮通知。
        for listener in tuple(self._listeners):
            listener(new_state)

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        """注册监听器，返回幂等的退订函数。"""
        self._listeners.append(listener)

        def unsubscribe() -> None:
            try:
                self._listeners.remove(listener)
            except ValueError:
                # 已经退订过；重复调用保持静默。
                pass

        return unsubscribe
