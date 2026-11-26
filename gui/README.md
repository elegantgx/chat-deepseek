# chat-deepseek GUI

`gui/app.py` 是 `chat-deepseek` 的 Python + PySide6（Qt 6）管理界面入口，只负责建
`QApplication`、装主题、调用 `cdgui.bootstrap.build_application()` 和进入事件循环。
界面、状态机与 CLI 交互都在 `gui/cdgui/`：窗口不直接读写 `data/`，所有操作都拼成
`chat-deepseek` 子命令，再由 `parsing.py` 把输出解析成账户列表、服务状态和提示。
已知失败会翻译成可操作说明，只有无法识别时才展示原始输出。服务端配置和 systemd
状态通过 `info` 读取，通过 `config set` 写入；聊天仍由 `serve` 提供的 Web UI 完成。

## 结构

```text
app.py              46 行入口：QApplication、主题、bootstrap、事件循环
cdgui/
  bootstrap.py      读 config.gui.json → 校验 Target → 建 Transport / Controller / 窗口
  controller.py     流程编排：唯一调用 CommandRunner 的地方，负责登录、服务、备份、切目标
  store.py          AppState 容器：纯 reducer + 不变量检查 + 订阅
  domain/           无 Qt 的纯逻辑
    target.py       Endpoint / Target / Capability / resolve_target
    facts.py        HostConfig、ServiceStatus、ForegroundSession
    state.py        AppState、PageId、TaskKey、Notice、assert_invariants
    reducers.py     全部 (AppState, Event) -> AppState 纯函数
    rules.py        is_running / page_url / backup_reason / action_verdict
    commands.py     CommandSpec 与每个 CLI 动作的 argv（密码只放 stdin）
    validation.py   密码、URL、远端绝对路径等表单校验
  infra/            只在这里起子进程、线程和 SSH
    process.py      本机子进程与 find_binary
    transport.py    Transport、LocalTransport、SshTransport
    ssh.py          SshSession：常驻 shell、哨兵退出码、here-doc、断线与超时
    gateway.py      CliGateway：info / login / whoami / user / backup / service
    runner.py       CommandRunner、CancelToken、主线程泵、代际与超时
    serve.py        ServeHandle / ServerProcess（前台 serve 与远端 PID）
    errors.py       CommandError 与退出码归一化
    persistence.py  GuiConfigRepository（config.gui.json 原子保存）
  ui/
    main_window.py  顶栏、左侧导航、QStackedWidget、状态栏、快捷键、关闭确认
    render.py       AppState -> UiState 投影，apply 幂等写控件
    views.py        控件引用容器与外壳尺寸
    protocols.py    ControllerProtocol
    pages/          服务 / 账户 / 备份 / 设置四页
    primitives/     Surface、Badge、Button、Field、Switch、Choice、Avatar、ListRow 等
    forms.py        FormGrid / FormRow / PathRow / CopyRow
    dialogs/        账户、密码、组、确认、消息、服务安装/更新
    tokens.py       间距、圆角、字号、高度与最小宽度
    palette.py      tone -> 颜色
parsing.py          CLI 中文输出解析（稳定契约）
gui_config.py       读写 v3 config.gui.json（local / ssh 两段、用户名、迁移）
server_config.py    计算服务端默认路径和默认监听/API 地址
service_plan.py     生成 systemd unit 路径与 service 命令（含远端 ssh 前缀）
theme.py            明暗配色、字号与全局样式表
fonts.py            系统 UI 字体选择
assets/             whale.svg（CC0）、whale.ico、whale.icns、whale.png
tests/              domain / infra / controller / store / UI 页面与窗口 / 对话框 / 配置解析
```

分层职责固定：`domain/` 只依赖标准库和 `parsing.py`，可脱离 Qt 单测；`infra/` 是唯一
允许执行命令、起线程和持有 SSH 通道的地方；`controller.py` 负责流程与副作用顺序；
`ui/` 只读 `AppState` / `UiState`，按钮的可见、可用和文案全部来自
`rules.action_verdict`，页面不自己判断权限或服务状态。`parsing.py`、`gui_config.py`、
`server_config.py`、`service_plan.py`、`theme.py`、`fonts.py` 是稳定契约层，留在
`cdgui/` 外面。

## 交互

### 窗口

- 左侧导航四页：服务 / 账户 / 备份 / 设置。服务项显示运行状态点，账户和备份显示
  数量徽标；未登录时这两个徽标显示 `—`。`Ctrl+1..4` 切页，`Ctrl+,` 进设置。
- 顶栏是当前目标、服务状态和身份：目标 chip 可打开“切换目标…”菜单，服务状态 chip
  跳到服务页，身份 chip 在未登录时登录、已登录时显示用户名（角色）和剩余时间并可退出。
- 状态栏显示 `版本 · 平台`（SSH 时追加 ` · SSH <host>`）、最近备份摘要和命令行帮助。
- 页面常驻在 `QStackedWidget`，切换不销毁表单；设置页有未应用改动时离开会先确认。
  窗口最小 900×740，窄宽时目标 chip 省略数据目录短名。

### 服务页

- 主操作按状态切换“启动服务 / 停止服务”；未初始化时变成“创建 Owner”并跳到账户页。
  旁边是“重启”“打开页面”和 `⋯` 溢出菜单，低频或危险操作集中在菜单里：安装服务、
  更新服务、卸载服务、命令行帮助。卸载会二次确认，且不删除数据目录。
- 状态卡下面是运行详情：数据目录、systemd 安装位置、linger 命令、开机自启和 linger
  徽标；未安装 systemd 时提供“改为 systemd 常驻…”。前台会话运行时才显示“运行日志”
  卡，保留最近 40 行并可复制。
- “启动后打开页面”默认开启，不持久化。地址按本机前台 URL > Public URL > 监听地址
  推导；远端只认 Public URL，没有可打开地址时不会打开。
- Linux + systemd 时启动/停止/重启走 `service`；未安装时走前台 `serve` 子进程，关闭
  窗口会停止它。Windows/macOS 或没有 systemd 的 Linux 没有服务后端，也只能前台运行。

### 账户页

- 页头是数量徽标、刷新和“+ 添加”；列表是 60px 两行成员行（头像、用户名、组标签、
  状态点），悬停/选中为长胶囊。列表可用键盘：`↑`/`↓` 移动并选中，空格切换选中，
  `Enter` 选中当前行。
- 底栏显示当前选中账户和“取消选择”，以及重置密码、禁用/启用、授予组、撤销组、删除。
  Owner 可操作其他 Owner 和授组，Admin 只能管理普通 User；不能禁用或删除自己。
- 空态分三种：未初始化时“创建第一个 Owner”，已初始化未登录时提示登录，已登录但
  没有账户时引导“+ 添加”。未登录时点刷新、添加等按钮会先弹登录对话框。

### 备份页

- 只有 Owner 能看到内容；未登录时看到锁视图和“Owner 登录后查看备份”，可直接登录；
  Admin 登录后看到“需要 Owner 登录”，改用 Owner 账户。页头显示当前目标的备份地址，
  操作有刷新、备份到…、立即备份。
- 服务运行中时页内出现前置条件条：“备份需要先停止服务”，旁边的“停止服务”要单独
  二次确认；停服务后不会自动重启。备份写入当前目标 `config.json` 的 `backup_dir`。
- 记录列表按时间、文件名、大小展示，选中后在底栏“恢复所选”。恢复前二次确认，并
  复述会覆盖 `chat.db`、`config.json`、`master.key` 和 `files/`。
- 远端不提供“备份到…”（远端路径不在本机）；备份写到远端配置的备份地址。

### 设置页

- 设置是页面而不是弹窗，整页可滚动，四张卡：连接、服务端配置、管理登录、关于。没有
  全局“确定”，前两张可编辑的卡各自保存：
  - **连接卡**：连接方式（本机 / SSH 远程）、本机二进制目录和数据目录，或 SSH 主机、
    远端二进制目录、远端数据目录。“测试连接”对表单目标跑一次 `info`；“应用切换”
    先写 `config.gui.json`，再停旧前台、对旧目标 `logout`、关旧通道，最后重读 `info`。
    任何一步失败都保留旧目标，不半切换。
  - **服务端配置卡**：备份地址、监听地址、Public URL、API 地址。只对当前目标生效，
    逐项 `config set` 后重读 `info`，不用表单值直接当事实。标题旁的徽标写明“来自
    本机 / SSH 主机 <host> 的 config.json”，不会把另一台主机的值套过来。
- 管理登录卡显示身份、组和过期时间，可退出；关于卡显示版本并可打开命令行帮助。
- 连接卡的路径规则与主窗口一致：本机二进制可填目录或可执行文件，数据目录必填；远端
  二进制目录必填且必须是绝对路径，远端数据目录可留空交给远端 CLI 默认值。
- 设置页不提供全局“恢复默认”：备份地址留空表示数据目录下的 `backups/`，监听地址不能
  为空，Public URL 和 API 地址按当前主机的需要填写。

### 登录与权限

- 不登录也能启停、安装、更新服务和改设置；账户页和备份页显示锁态，点登录/刷新/
  添加/备份会弹出登录对话框。
- 登录通过 CLI `login` 完成，密码只走 stdin（本机 `--password-stdin`，远端 here-doc），
  不进 argv、日志或界面。登录态固定 15 分钟，关闭 GUI 会自动 `logout`；重新打开需要
  重新登录。
- 只有 Admin 和 Owner 能登录，`User` 会被 CLI 拒绝。Admin 不能授组、不能备份、不能
  操作 Owner；Owner 拥有全部账户和备份能力，但同样不能禁用/删除自己。
- 用户名记在 `config.gui.json` 对应连接的 `username`，不保存密码。切换连接方式、主机
  或数据目录后旧登录态失效，需要重新登录。

### SSH 远程

- 设置里选“SSH 远程”，主机写 `~/.ssh/config` 的别名或 `user@host`。只使用系统 `ssh`
  和密钥/agent 认证（`BatchMode`），第一次连接前先在终端执行一次 `ssh <主机>`。
- GUI 启动后保持一个 `ssh -T <主机> 'exec /bin/sh'` 常驻通道，所有 CLI 命令都在这个
  shell 里执行；CLI 登录态跟着这个 shell 走，登录一次后其余管理命令共享。需要 stdin 的
  命令用 here-doc，其余命令加 `< /dev/null`；每条命令用哨兵取退出码。
- 连接断开、超时或登录态被清掉时返回 255，GUI 关掉通道并提示重新登录；下一条命令会
  重连。远端二进制目录必填，远端数据目录留空由 `info` 回填。
- 远端不做端口映射、不做 SFTP：路径不在本机浏览，`备份到…` 隐藏，打开页面只认远端
  配置的 Public URL。
- 远端前台 `serve` 启动时先报远端 PID，停止时经常驻通道发 `SIGTERM`（`ssh -T` 没有
  pty，断开客户端不会给远端进程发 SIGHUP）。远端常驻请安装 systemd 服务。
- 远端用户级 systemd 服务需要 linger：SSH 通道断开后没有 linger 的 user manager 会被
  logind 停掉。服务页和安装对话框按状态给出 `loginctl enable-linger` / `disable-linger`
  的复制命令。
- 备份地址、监听地址、Public URL 和 API 地址只认当前目标主机自己的 `config.json`；
  切换主机后重新读，不会沿用上一台或 GUI 所在机器的值。

## 安装与运行

需要 Python 3.10+。在仓库根目录执行（依赖装在 `gui/.venv`，该目录不提交）：

```sh
python3 -m venv gui/.venv
gui/.venv/bin/pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r gui/requirements.txt
gui/.venv/bin/python gui/app.py
```

Windows PowerShell：

```powershell
py -3 -m venv gui\.venv
gui\.venv\Scripts\pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r gui\requirements.txt
gui\.venv\Scripts\python gui\app.py
```

`app.py` 默认使用 `chat-deepseek` 二进制所在目录（仓库根目录；Windows 为
`chat-deepseek.exe`），也可以在设置页选择。Linux 发布包根目录的 `gui/` 就是本目录，
CLI 在上一级；发布包不提供 Linux GUI 二进制。

GUI 的本地配置保存在用户配置目录的 `config.gui.json`（v3）：Linux 是
`~/.config/chat-deepseek/`，macOS 是 `~/Library/Application Support/chat-deepseek/`，
Windows 是 `%APPDATA%\chat-deepseek\`。v1 的顶层字段和 v2 的 `local` 段会自动迁移，
旧 `backup_dir` 通过 `config set` 写进数据目录的 `config.json`。配置里 `local` 和
`ssh` 各存一份路径，切换连接不用重新输入；macOS 默认数据目录是
`~/Library/Application Support/chat-deepseek/data`。

没有图形桌面的服务器直接用 CLI，不需要安装这些依赖；Linux 缺 Qt 的 xcb 运行库时，
Debian/Ubuntu 可安装 `libxcb-cursor0`、`libxkbcommon-x11-0`、`libgl1`、`libegl1` 等
系统包。

## 测试

```sh
gui/.venv/bin/python -m unittest discover -s gui/tests -v
```

共 627 个用例，覆盖 domain 纯函数、infra（含 fake ssh / fake CLI）、controller 流程、
store 不变量、窗口骨架、四个页面、对话框、bootstrap、配置迁移、解析器和架构守卫。页面测试用
`QT_QPA_PLATFORM=offscreen`，不会弹出真实窗口。

## 注意

- GUI 直接解析 CLI 的中文输出；CLI 提示或表格格式变化时，改 `parsing.py` 并补测试。
  已知失败（服务运行中、端口占用、最后一个 Owner、账户不存在、密码不合规等）会翻译
  成可操作提示；只有完全识别不了时才显示“未知错误”和原始输出。
- `config.gui.json` 是运行时文件，不提交；只记上次登录的用户名，不保存密码。
- 保存监听地址、Public URL、API 地址后需要重启服务生效；`backup_dir` 在下次备份时
  生效。备份会覆盖 `chat.db`、`config.json`、`master.key` 和 `files/`，恢复前必须停止
  服务。
- 关闭窗口会停止由本窗口启动的 `serve`，并退出当前 GUI 的 CLI 登录；已安装的 systemd
  服务、外部启动的进程不会被接管或停止。Windows 上停止会话进程是强制结束；同一个
  数据目录同时只能有一个服务实例。
- 窗口标题栏、边框和圆角使用系统原生：Windows 是 x/□/-，GNOME 只有关闭按钮，macOS
  是交通灯。对话框也用原生标题栏。界面跟随系统深浅色，并在系统主题变化时重刷配色、
  QSS 与原生控件调色板。
- 字体优先 Microsoft YaHei UI / PingFang SC / Noto Sans CJK SC，关闭子像素抗锯齿并
  使用灰度抗锯齿，字号比常规桌面控件大一档。卡片、按钮、输入框、开关的圆角与间距
  都走 `cdgui/ui/tokens.py`。
- 界面跟随系统主题，启动时先读平台调色板再切 Fusion；GNOME 下直接读 `gsettings` 的
  `color-scheme` / `gtk-theme`，并用 `dconf watch` 跟随切换。
- 依赖不随仓库提交；PySide6 / Qt 的许可证见各自发布包。
- 发布包中 Windows 用 `.ico` 设置 EXE 图标；macOS 用 `.app` 承载 `.icns` 图标并打进
  DMG。Linux 发布包不含 GUI 二进制；从源码运行或自行打包时，ELF 文件不携带文件图标，
  窗口/任务栏图标由 Qt 在运行时设置。
