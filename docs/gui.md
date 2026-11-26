# GUI（PySide6 管理界面）

> 从 AGENTS.md 拆出的 GUI 细节：分层、四页、SSH、配置迁移、测试与视觉层。
> 入口与构建见 `gui/README.md`；重构设计依据见 `gui/REFACTOR_PLAN.md` 与 `gui/BEHAVIOR_BASELINE.md`。

## 1. 定位

- GUI 是 `chat-deepseek` CLI 的图形外壳：只拼子命令、解析中文输出，不直接读写服务端数据库。
- 只支持 Linux / Windows / macOS 桌面；打包由发布流水线的 PyInstaller 步骤负责。
- `gui/app.py` 是薄入口（QApplication → 主题 → bootstrap → 事件循环），界面逻辑在 `gui/cdgui/`。

## 2. 分层

```text
gui/
  app.py                  入口：QApplication、theme.install、bootstrap、exec
  cdgui/
    domain/               纯 Python：Target/AppState/reducers/rules/commands/validation
    infra/                process/transport/ssh/gateway/runner/serve/errors/persistence
    store.py              AppState 容器、不变量、订阅
    controller.py         流程编排、代际、超时、关闭顺序
    ui/                   main_window/render/views/pages/primitives/forms/dialogs/tokens/palette
    bootstrap.py          配置 → Target → Transport → Controller → 窗口
  parsing.py              CLI 中文输出解析（稳定契约）
  gui_config.py           v3 config.gui.json 读写与 v1/v2 迁移
  server_config.py        默认路径、监听/API 地址
  service_plan.py         systemd unit 与 service 命令
  theme.py / fonts.py     配色、字号、系统字体
  assets/                 鲸鱼图标（SVG/ICO/ICNS/PNG）
  tests/                  domain/infra/controller/store/窗口/四页/对话框/bootstrap/架构守卫
```

- **事实与派生分离**：事实只来自 I/O（`HostConfig`、`ServiceStatus`、`Identity`、`ForegroundSession`、`Target`）；按钮可见/可用/文案全部由 `domain/rules.action_verdict` 产出 `Verdict(enabled, visible, text, tooltip, reason)`，页面不自己判断权限或服务状态。
- **单一渲染入口**：`store` 状态 → `derive_ui(state, now)` → `UiState` → `render.apply(ui, views, state)`；`AppState` 里没有 `visible/enabled/loading/busy/pending` 这类字段。
- **命令执行**：`CommandRunner` 单工作线程，按 `Target.key` 串行；`blocking=True` 是用户动作（上一条未完成时拒绝），`blocking=False` 是内部跟进；`QueuePump` 由 30ms QTimer 在主线程泵出结果。
- **Transport**：`LocalTransport` 跑本机子进程；`SshTransport` 包一条常驻 `ssh -T <host> 'exec /bin/sh'`，用哨兵取退出码、here-doc 送密码、255 表示断线。
- **错误归一**：退出码 3→AUTH、4→FORBIDDEN、127→MISSING_BINARY、255→TRANSPORT、2→USAGE；中文失败的翻译仍由 `parsing.explain_failure` 负责。

## 3. 四页

- **服务**：一个主操作（启动/停止，未初始化时“创建 Owner”）+ 重启/打开页面 + `⋯`（安装/更新/卸载服务、命令行帮助）；下面是运行详情（数据目录、安装位置、linger 命令与徽标）和仅前台会话显示的日志。
- **账户**：成员行（头像、用户名、组标签、状态点），支持 `↑`/`↓`/空格/`Enter`；底栏做重置密码、禁用/启用、授组/撤组、删除。
- **备份**：独立成页；服务运行时先显示“备份需要先停止服务”，停止操作单独二次确认；记录列表可恢复，恢复确认复述会覆盖 `chat.db`、`config.json`、`master.key` 和 `files/`。
- **设置**：连接卡（本机/SSH、两套路径、测试连接、应用切换）与服务端配置卡（备份/监听/Public URL/API、保存配置）各自提交，另有管理登录和关于卡。
- 导航：服务项显示状态点；账户/备份徽标未登录显示 `—`，登录后显示数量。

## 4. 登录与权限

- 登录走 CLI `login`，密码只经 stdin（远端 here-doc），不保存；15 分钟过期；关闭 GUI 自动 `logout`。
- 仅 Admin/Owner 可登录；Admin 不能授组、不能备份、不能操作 Owner；Owner 也不能禁用/删除自己。
- 未登录时账户页/备份页显示锁态与登录入口；点登录/刷新/添加/备份会弹登录框。
- 记住上次用户名（不记密码）；GUI 启动时不继承父 shell 的 CLI 会话。
- 切换连接方式（`Target.key` 变化）时先停旧前台、对旧目标 `logout`、关旧通道，再切新目标并重读 `info`；失败保留旧目标，不半切换。

## 5. 本机 / SSH

- 只使用系统 `ssh` 与用户 `~/.ssh/config`，不引入 paramiko，不做端口映射和 SFTP。
- 远端二进制目录必填；远端数据目录可留空，由 `info` 回填。
- 登录态跟着常驻 shell，不需要给 CLI 加会话键；断线返回 255 时关闭通道并提示重新登录，下一条命令自动重连。
- 远端前台 `serve` 先打印 `__CD_SERVE_PID__` 再 `exec`，整段包在 `/bin/sh -c` 里兼容 fish/csh；停止时经常驻通道发 `SIGTERM`，再兜底结束本地 ssh（`ssh -T` 无 pty，只杀本地 ssh 会在远端留孤儿进程）。
- 远端用户级 systemd 需要 linger，否则通道断开后会被 logind 停掉。
- 远端只认 Public URL 打开页面；“备份到…”和路径浏览隐藏；服务端四项只认当前 target 的 `config.json`，`info` 返回前留空，不用本机默认值兜底。

## 6. 服务托管（systemd）

- 仅 Linux + systemd；默认用户级 unit（`~/.config/systemd/user/chat-deepseek.service`），`--system` 需 root、`--run-as` 和显式 `--data-dir`。
- GUI 只直接执行用户级安装；系统级只生成“安装命令”和“CLI 帮助”两条可复制文本，不执行、不展示不可修改的 unit。
- 安装可选项：开机自启（`--enable`）、安装后启动；更新可调整开机自启（`--force` + `restart`，失败弹错误）；停止/重启/卸载通过 `service` 子命令。
- 关闭 GUI 不停止 systemd 服务；未安装时保留前台会话模式。
- 没开 linger 时给出 `loginctl enable-linger <user>` 提示，不执行 sudo。

## 7. 配置

- `config.gui.json` 为 v3：`version`、`connection`（`local`/`ssh`）、`local{binary_dir,data_dir,username}`、`ssh{host,binary_dir,data_dir,username}`；v1/v2 自动迁移。
- v1 的 `backup_dir` 在首次启动时迁移进服务端 `config.json`（`config set backup_dir`），只在当前 target 的 `backup_dir` 仍是默认值时执行，失败静默。
- 密码不落盘；服务端四项与路径只从 `info` 读，通过 `config set` 写。

## 8. 测试

- `gui/.venv/bin/python -m unittest discover -s gui/tests`：domain、infra（含 fake ssh / fake CLI）、controller、store、窗口、四页、对话框、bootstrap、配置迁移、解析器。
- `tests/test_architecture.py` 用 AST 锁分层：domain/infra 不碰 Qt、ui 不碰 subprocess/threading、`paintEvent` 数量上限、`QGridLayout` 只出现在 forms/dialogs、页面只用 `ui.is_owner`、`app.py` ≤80 行、不 import 旧入口。
- `tests/test_style.py` 锁视觉层取值来源（颜色只来自 theme、尺度只来自 tokens、无裸色值、无直接 `QFont`）。

## 9. 视觉层

- 窗口标题栏、边框与对话框标题栏都用系统原生，不做 frameless / 透明顶层窗口 / 自绘外壳。
- 尺寸、间距、字号、圆角走 `ui/tokens.py`；颜色只经 `ui/palette.py` 从 `theme.py` 取；页面不写十六进制色值或裸数字。
- 明暗跟随系统；GNOME 下读 `gsettings` 并用 `dconf watch` 跟随；Windows 子进程用 `CREATE_NO_WINDOW` 避免控制台闪窗。
- **2026-11-26 起视觉层正在重做**（分支 `refactor/gui-liquid-glass`）：目标为 Apple Liquid Glass 的「功能层玻璃 + 内容层标准材质」，HIG 规则与效果图仍在评审，方案未定稿；定稿前以上一段的 token/颜色约束仍有效，不要按未定稿方案改产品代码。
