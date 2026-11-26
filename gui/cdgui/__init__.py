"""chat-deepseek GUI 的新架构。

`cdgui.domain` 是纯领域层：只依赖标准库和顶层 `parsing` / `server_config`，
不导入 Qt、`cdgui.infra` 或 `cdgui.ui`。C3 起在这之上增加基础设施、编排和
视图层；旧 `app.py` 在 C6 才切换过来。
"""
