"""GUI 基础设施层（C3）。

- `process`：本机子进程执行（CommandResult、run_command、可取消的 run_popen）
- `ssh`：常驻 SSH 通道（原 `ssh_session.py` 逻辑，行为不变）
- `serve`：前台长进程（ServerProcess / ServeHandle）
- `transport`：LocalTransport / SshTransport
- `gateway`：CliGateway（argv 由 domain.commands 构造）
- `runner`：CommandRunner / CancelToken / QueuePump
- `errors`：ErrorKind / CommandError / normalize
- `persistence`：GuiConfigRepository

本包不导入 Qt；`cdgui.domain` 也不反向依赖这里。
"""
