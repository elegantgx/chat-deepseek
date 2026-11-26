# chat-deepseek

基于 DeepSeek API 的自托管聊天应用：Go 服务端 + React Web 客户端。账户、会话、附件、设置和 API Key 都保存在服务器上，浏览器只保留登录 Cookie 和内存中的 CSRF token。

本项目是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的 fork，当前版本 `0.1.5-official0.1.4`，代码基线为上游 `v0.1.4`。仓库位于 [GitHub](https://github.com/elegantgx/chat-deepseek)，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 运行

需要 Node.js 22.12+、pnpm、Go 1.27+。先构建前端并把产物嵌入二进制：

```sh
pnpm install
pnpm build
CGO_ENABLED=0 go build -o chat-deepseek ./cmd/chat-deepseek
```

初始化第一个 Owner 并启动服务：

```sh
./chat-deepseek setup --username owner
./chat-deepseek serve
```

也可以直接运行 `./chat-deepseek`：没有数据目录时先进入 setup，之后启动服务并打开浏览器。默认监听 `127.0.0.1:8090`，在页面登录后到「系统设置 → 数据管理」填写 DeepSeek API Key。

常用参数：

```text
--data-dir <dir>       数据目录，默认是二进制同级的 data/
--listen <addr>        监听地址，默认 127.0.0.1:8090
--public-url <url>     对外访问地址（HTTPS 反代时用于 Secure Cookie）
--api-origin <url>     DeepSeek API 地址，默认 https://api.deepseek.com
--no-browser           启动时不自动打开浏览器
--backup-dir <dir>     备份地址，默认读 config.json 的 backup_dir 或 data/backups（backup）
--output <file>        备份输出文件路径（backup，覆盖默认文件名）
--yes                  跳过恢复确认（backup restore）
--username <name>      登录账户名（login）
--password-stdin       从标准输入读取密码（setup / login / user add / user reset-password）
```

服务面向自托管使用，默认只监听本机。需要局域网或公网访问时，改成 `--listen 0.0.0.0:8090`（或 `config set listen`），并建议放在 HTTPS 反向代理后面。当前发布不提供 Docker 镜像或 Web 管理页；Linux 可以用 `service` 命令交给 systemd，其他情况用用户自己的 supervisor、tmux 或 nohup 托管。

## 命令行

| 命令 | 作用 |
| --- | --- |
| `setup` | 创建第一个 `Owner`，只能执行一次 |
| `serve` | 前台启动服务（会话模式），`Ctrl+C` 停止 |
| `info` | 输出版本、路径、配置和 systemd 状态（固定 `key=value`） |
| `config set` | 修改 `config.json`：`listen`、`public_url`、`api_origin`、`backup_dir` |
| `service ...` | Linux systemd 托管：`install` / `uninstall` / `start` / `stop` / `restart` / `status` |
| `login` / `logout` / `whoami` | CLI 管理登录，按终端隔离，固定 15 分钟过期 |
| `user ...` | 创建、禁用、授组、重置密码、删除账户 |
| `backup ...` | 备份、列出备份、恢复备份 |
| `version` | 版本信息 |

- `info`、`config set`、`service` 不需要应用登录；`service install` 仍要求数据目录已初始化。`info` 只读，不会创建数据库、`config.json` 或 WAL 文件。
- `config set` 只修改指定字段，保留 `config.json` 里的其他字段，文件仍然是 `0600`。修改 `listen`、`public_url`、`api_origin` 后需要重启 `serve`，`backup_dir` 在下次备份时生效。
- 退出码：`0` 成功、`1` 运行错误、`2` 用法错误、`3` 未登录或登录过期、`4` 权限不足。
- `user list`、`whoami`、`backup list`、`info`、`service status` 的文本列是稳定契约；GUI 和脚本依赖这些格式，改动需要同步 `gui/parsing.py`。

## 图形界面（可选）

`gui/app.py` 是 Python + PySide6（Qt 6）管理界面的薄入口，界面逻辑在 `gui/cdgui/`：按钮只负责拼出 `chat-deepseek` 子命令，输出由 `gui/parsing.py` 解析成账户列表、服务状态和提示；已知失败会翻译成可操作说明，识别不了才显示原始输出。账户、会话、备份逻辑仍全部在 `chat-deepseek` 里，不另写一套。它覆盖 `setup`、`serve`、`backup`、`user ...`、`login` / `logout` / `whoami`、`version` 和 `help`，并通过 `info` / `config set` / `service` 显示服务端配置、保存设置和管理 systemd 服务。聊天仍由 `serve` 提供的现有 Web UI 完成。

窗口左侧是四页导航：服务 / 账户 / 备份 / 设置。服务页把主操作（启动/停止，未初始化时为创建 Owner）、重启、打开页面和 `⋯` 溢出菜单（安装/更新/卸载服务、命令行帮助）分开；备份独立成页，服务运行时会先提示“备份需要先停止服务”，停止操作单独二次确认；设置从弹窗改成页面，连接卡和服务端配置卡各自保存，另有管理登录和关于卡；账户页支持 `↑`/`↓`、空格和 `Enter` 键盘操作。未登录时账户和备份的导航徽标显示 `—`，登录后显示数量；服务项显示运行状态点。

设置里的“连接方式”可以选择本机或 SSH 远程。SSH 模式使用系统 `ssh`，只支持密钥/agent 认证（先在终端执行一次 `ssh <主机>` 确认可以直接登录），并在 GUI 启动后保持一个 `ssh -T <主机> 'exec /bin/sh'` 常驻通道，所有 CLI 命令都在这个 shell 里执行；CLI 的登录态按 shell 保存，所以登录一次后其余管理命令共享同一个登录态。远端二进制目录必填，远端数据目录留空表示用远端 CLI 默认值；GUI 不做端口映射，打开页面需要远端配置 Public URL，也不提供 SFTP。

依赖装在 `gui/.venv`（已 gitignore）。在仓库根目录：

```sh
python3 -m venv gui/.venv
gui/.venv/bin/pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r gui/requirements.txt
gui/.venv/bin/python gui/app.py
```

Windows 用 `gui\.venv\Scripts\python gui\app.py`；更完整的命令见 [gui/README.md](gui/README.md)。需要 Python 3.10+ 和 `requirements.txt` 里的 PySide6。Linux 还缺 Qt 的 xcb 运行库时，Debian/Ubuntu 可安装 `libxcb-cursor0`、`libxkbcommon-x11-0`、`libgl1`、`libegl1` 等系统包。

`gui/app.py` 默认使用 `chat-deepseek` 二进制所在目录（仓库根目录），也可以在设置页改。GUI 本地配置是平台用户配置目录的 `config.gui.json`（v3，旧版会自动迁移）：Linux 是 `~/.config/chat-deepseek/`，macOS 是 `~/Library/Application Support/chat-deepseek/`，Windows 是 `%APPDATA%\chat-deepseek\`；里面保存连接方式、`local` 与 `ssh` 两段路径和上次登录的用户名。监听地址、Public URL、API 地址和备份地址通过 `chat-deepseek config set` 写入当前目标数据目录的 `config.json`，`serve` 启动时直接读取；设置页的“应用切换”和“保存配置”分别保存连接与服务端配置；监听地址、Public URL、API 地址保存后重启服务生效，备份地址在下次备份时生效。密码通过 `--password-stdin` 从 GUI 传给子进程，不出现在命令行参数或输出日志里；上次登录的用户名记在 `config.gui.json`，不保存密码。

Linux + systemd 时，服务页显示 systemd 服务的安装位置（用户目录）、运行、开机自启和 linger 状态，可以启动、停止、重启、安装、更新和卸载。安装对话框用下拉框选择“用户目录”或“系统目录”：用户目录直接安装，不需要 root；系统目录需要 root，GUI 不执行安装，只给出“安装命令”和“CLI 帮助”两条单行字段，各自带复制按钮；单行显示不下时中间省略，复制的是完整命令。安装后在终端运行 CLI 帮助查看启动、停止、重启和卸载命令。用户级安装本身只写 unit 并 `daemon-reload`；未开启 linger 时注销后服务会停止，对话框按当前状态提供 `loginctl enable-linger` 或 `loginctl disable-linger` 命令的复制按钮；“更新服务”按当前配置重写 unit（`--force`）并重启服务，可以同时调整开机自启。未安装服务时“启动服务”走前台会话模式，关闭窗口会停止该进程；已安装的 systemd 服务不会被关闭窗口停止。Windows/macOS 没有 systemd，继续使用会话模式，常驻交给任务计划程序/NSSM 或 LaunchAgent。GUI 依赖 CLI 的参数名、退出码和中文输出；CLI 文案或表格格式变化时需要同步改 `gui/parsing.py`。Windows 上停止会话进程是强制结束；同一个数据目录同时只能有一个服务实例。无图形桌面的服务器继续直接用 CLI，GUI 不是运行必需组件。

SSH 模式下列表和服务命令都在远端执行，systemd 状态来自远端 `info`。远端用户级 systemd 服务同样需要 linger：SSH 通道断开后没有 linger 的 user manager 会被 logind 停掉，服务也跟着停止；常驻场景应开启 linger，或在远端安装系统级 unit。远端前台 `serve` 会随 GUI 关闭或 SSH 断开结束，点“停止服务”会按远端 PID 结束进程并释放端口。备份地址、监听地址、Public URL 和 API 地址都按当前主机自己的 `config.json` 读取，切换主机不会沿用上一台的值。远端路径不在本机，`备份到…` 隐藏；GUI 只在远端配置了 Public URL 时才能打开页面。

GUI 使用 CLI 的登录态：不登录也能启停、安装、更新服务和改设置，账户页和备份页显示锁图标与登录入口；点击登录、刷新、添加或备份会弹出登录框。只有 Admin 和 Owner 能登录，按钮会按当前身份置灰不可执行的操作；Admin 不能授组、备份或操作 Owner，Owner 也不能禁用/删除自己。登录 15 分钟后过期，关闭 GUI 会自动退出登录。SSH 模式下登录态绑定常驻通道，关闭窗口会先 `logout` 再断开；切换连接方式、主机或数据目录后需要重新登录。

## 发布流水线

`.github/workflows/release-{linux,windows,macos}.yml` 是三个手动触发的 GitHub Actions 工作流：在 Actions 里选择 Release Linux、Release Windows 或 Release macOS，点击 Run workflow；push、标签、Pull Request 和定时任务都不会自动触发。

每个工作流都在自己的 runner 上完整执行 Web 构建、Go CLI 编译和 ZIP 生成；Windows 和 macOS 还会构建 PyInstaller GUI。最后得到：

```text
chat-deepseek-<版本>-linux-amd64.zip
chat-deepseek-<版本>-windows-amd64.zip
chat-deepseek-<版本>-macos-arm64.zip
```

版本取自 tag 名；在分支上手动运行时使用提交的 SHA。Linux ZIP 根目录：

```text
chat-deepseek
gui/                 GUI 源码
src/                 完整项目源码（内部保留前端 src/src/）
README.md
LICENSE
THIRD_PARTY_NOTICES.md
```

Windows ZIP 根目录还包含预编译 GUI `chat-deepseek-gui.exe`，`src/` 同样是完整项目源码。

macOS ZIP 只包含一个 DMG：

```text
chat-deepseek-<版本>-macos-arm64.zip
  chat-deepseek-<版本>-macos-arm64.dmg
```

DMG 内只有 `chat-deepseek-gui.app` 和指向 `/Applications` 的链接；CLI、`config.gui.json` 和三份文档都在 `.app/Contents/Resources` 里。把 `.app` 拖到 Applications 即可；`config.gui.json` 使用 v2 结构，把 `local.data_dir` 指到 `~/Library/Application Support/chat-deepseek/data`；`backup_dir` 由首次运行后的 `info` / `config set` 管理。`.app` 内的副本作为首次启动的模板，真正的用户配置仍写这个标准目录。macOS 包不再附带源码。

Linux 不附带预编译 GUI。PyInstaller onefile 会绑定构建机的 glibc，无法同时覆盖 Ubuntu、Fedora 等不同版本；`gui/` 是可直接构建的 GUI 源码，按 [gui/README.md](gui/README.md) 在解压目录创建 venv、安装 PySide6，再运行 `gui/.venv/bin/python gui/app.py`。CLI 是静态二进制，可以直接使用。`gui/` 是完整源码中 `src/gui/` 的副本，方便解压后直接编辑；不使用符号链接。

- Linux 使用 `ubuntu-latest`，只构建 CLI 并打包源码；Windows 使用 `windows-latest`，构建 CLI 和 GUI；macOS 使用 `macos-latest`（arm64），构建 `.app`、DMG 和只含 DMG 的 ZIP。
- 在 tag 上运行会把 ZIP 上传到对应的 GitHub Release；在分支上运行只保留 Actions artifacts。
- 三个 workflow 可以并行；发布步骤会对同一 tag 的 Release 创建和上传做重试，避免同时创建时的竞态。
- Windows EXE 和 macOS `.app` 使用鲸鱼应用图标；Linux 从源码构建 GUI 时由程序设置窗口/任务栏图标。
- macOS 包只做 ad-hoc 签名，没有开发者签名/公证，首次打开可能需要在 Finder 右键“打开”，或执行 `xattr -cr`。Windows 包也未签名，可能出现 SmartScreen 提示。

## 命令行登录

`user ...` 和 `backup ...` 需要先登录。登录态按 shell 隔离：每个终端各自 `login`，互不覆盖；固定 15 分钟后过期，不随命令续期。

```sh
./chat-deepseek login --username owner
./chat-deepseek whoami
./chat-deepseek logout
```

- 只有 `Admin` / `Owner` 能登录；普通 `User` 没有 CLI 管理权限。
- `logout` 只退出当前终端，其他终端不受影响。
- 未登录或登录过期时退出码为 `3`，权限不足为 `4`，便于脚本和 GUI 判断；完整退出码见上面的命令行一节。
- 登录态不写进 `data/`：Linux 在 `$XDG_RUNTIME_DIR/chat-deepseek/sessions/`（tmpfs），macOS 在 `$TMPDIR/chat-deepseek/sessions/`，Windows 在 `%LOCALAPPDATA%\chat-deepseek\run\sessions\`；数据库只保存 token 的 SHA-256。
- 非交互场景用 `--password-stdin`，密码不会出现在命令行参数里。

权限：

| 操作 | 需要 |
| --- | --- |
| `setup`、`serve`、`version` | 不需要登录；`setup` 只能执行一次 |
| `login`、`logout`、`whoami` | — |
| `user list`、`user groups`、创建普通 User、管理普通 User | Admin 或 Owner |
| `user grant` / `user revoke`、操作 Admin/Owner、`backup` 创建/列表/恢复 | Owner |

能登录服务器的人本来就能直接读写 `chat.db` 和 `master.key`，所以 CLI 登录不是防入侵边界；它是管理规范：让授权、归属和危险操作有据可查，同时避免直接改库绕过最后一名 Owner、会话吊销等代码里的不变量。空数据目录上的首次 `backup restore` 是引导路径，不需要登录；已有实例上恢复必须由 Owner 执行。

## 账户

账户和组管理只通过服务端 CLI 完成，没有公开注册。

```sh
./chat-deepseek login --username owner
./chat-deepseek user add --group Admin --password-stdin alice
./chat-deepseek user list
./chat-deepseek user groups bob
./chat-deepseek user grant bob Admin
./chat-deepseek user revoke bob Admin
./chat-deepseek user disable alice
./chat-deepseek user enable alice
./chat-deepseek user reset-password --password-stdin alice
./chat-deepseek user delete --yes alice
```

`Admin` 可以创建普通 `User`、禁用/启用/重置/删除普通 `User`，但不能指定组，也不能操作 `Admin`、`Owner`；授组和操作 `Admin`/`Owner` 需要 `Owner`。

组只有 `User`、`Admin`、`Owner`。所有账户默认属于 `User`；`Admin`、`Owner` 是附加组，能力取并集。不能移除、禁用或删除最后一名活动 `Owner`。忘记密码由 CLI 重置，没有邮件或 TOTP 找回。用户名可以是 1-64 个 ASCII 字母、数字或 `. _ -`。登录后可在「系统设置 → 账户管理」修改自己的用户名、密码和头像，保存后立即生效，不需要刷新页面。

## 数据

默认数据目录与二进制同级：

```text
data/
  config.json          # 监听地址、Public URL、API 地址、备份地址
  chat.db              # SQLite（账户、会话、附件元数据、设置）
  master.key           # API Key 加密主密钥（0600）
  files/<user_id>/     # 附件原件
  backups/             # backup 命令生成的 ZIP
```

Chat 会话以完整 JSON 保存，使用 `version` 乐观锁处理多标签页并发；Web 端删除会话是永久删除，会同时清理只属于该会话的附件。附件按用户隔离，聊天请求由服务端把本地附件 ID 换成 DeepSeek `file_id`，浏览器不接触 API Key。

API Key 使用 AES-256-GCM 加密后写入 SQLite，`master.key` 单独保存；接口只返回是否已配置，不返回密文或明文。备份请用下面的 `chat-deepseek backup`，ZIP 会包含 `config.json`、`chat.db`、`master.key` 和 `files/`；缺少 `master.key` 将无法解密已有 API Key。

浏览器不使用 localStorage 或 IndexedDB；登录状态是 HttpOnly Cookie，CSRF token 只保存在当前页面内存中。

## 备份

备份前先停止服务。`backup` 会检查数据目录里是否存在 `chat.db-wal` 或 `chat.db-shm`，任一存在就拒绝备份或恢复，因为它们通常说明服务仍在运行。

备份地址按 `--backup-dir` > `config.json` 的 `backup_dir` > `data/backups/` 解析，`backup`、`backup list`、`backup restore` 使用同一套规则。可以用 `config set backup_dir /path/to/backups` 设为长期默认，`config set backup_dir ""` 清除；备份地址不能是数据目录本身。

```sh
# 没设置 backup_dir 时写到 data/backups/chat-deepseek-<时间>.zip
./chat-deepseek backup

# 改备份地址
./chat-deepseek backup --backup-dir /path/to/backups

# 也可以指定单个输出文件（默认文件名之外的路径）
./chat-deepseek backup --output /path/to/chat-deepseek-backup.zip

# 列出备份：NAME、SIZE、TIME
./chat-deepseek backup list
./chat-deepseek backup list --backup-dir /path/to/backups

# 恢复指定的备份
./chat-deepseek backup restore chat-deepseek-20261123-120220.zip
./chat-deepseek backup restore --backup-dir /path/to/backups --yes chat-deepseek-20261123-120220.zip
```

ZIP 内容相对于数据目录：`config.json`、`chat.db`、`master.key`、`files/`，不会把 `backups/` 或自定义备份目录打进去。

`backup restore` 会用备份覆盖这四项；备份里没有的项会被删除，以回到备份时的状态。恢复时会保留 `backups/`。交互式终端会要求输入 `yes` 确认；脚本或 GUI 使用 `--yes`。恢复完成后需要重新启动服务。

`config.json` 也会进入备份 ZIP，所以恢复会连 `backup_dir` 一起恢复到备份时的值。换机器或原路径不存在时，恢复后需要重新 `config set backup_dir`（或每次加 `--backup-dir`），否则下次备份会写到旧地址。

## 常驻运行

默认的 `serve` 是前台进程，按 `Ctrl+C` 或收到 `SIGTERM` 退出；适合 SSH 会话、tmux、nohup 或自建 supervisor。Linux 使用 systemd 时，可以用 `service` 生成 unit，不需要手写：

```sh
# 用户级（当前用户，不需要 root）
./chat-deepseek service install --enable
./chat-deepseek service start

# 让用户服务在注销后继续运行
loginctl enable-linger "$USER"
```

- `install` 只写 unit 并执行 `daemon-reload`，不会启动；`--enable` / `--disable` 切换开机自启。重复安装需要 `--force`。`service --help` 列出 install / uninstall / start / stop / restart / status 和 `--system` 说明。
- 用户级 unit 在 `~/.config/systemd/user/chat-deepseek.service`，`WantedBy=default.target`；没有开启 linger 时注销会停止服务，CLI 会打印提示，但不会自动执行 `loginctl`。
- 系统级 unit 在 `/etc/systemd/system/chat-deepseek.service`，`WantedBy=multi-user.target`，需要 root，并显式指定运行用户和数据目录：

```sh
sudo ./chat-deepseek service install --system --run-as chat --data-dir /srv/chat-deepseek/data --enable
sudo ./chat-deepseek service start --system
```

  服务不会以 root 运行；`--run-as` 也可以用 `SUDO_USER` 推断，但 `--data-dir` 必须显式给出。同时存在用户级 unit 时不要同时启动，两者会争抢同一端口。
- `service stop` / `restart` / `status` / `uninstall` 都支持 `--system`；`uninstall` 会停止、取消自启并删除 unit，不会删除数据。
- 日志交给 journald：`journalctl --user -u chat-deepseek`（用户级）或 `sudo journalctl -u chat-deepseek`（系统级）。
- 只有 Linux + systemd 支持 `service`。Windows 用任务计划程序或 NSSM 托管 `chat-deepseek serve`；macOS 用 LaunchAgent；Linux 没有 systemd 时用 tmux、nohup 或 NAS 自带的任务计划。
- 同一个数据目录同时只能有一个服务实例；`serve` 的监听地址来自 `config.json`，unit 里不写 `--listen`。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出；导入在服务端原子替换，失败不会留下半套数据。
- 服务端账户登录、CSRF 防护、登录限流；每个用户独立会话、附件、设置和 API Key；可修改自己的用户名、密码和头像。
- 系统设置沿用官方左右分栏布局：通用设置、账户管理、数据管理、关于；偏好即时生效，账户资料保存后弹窗保持打开并就地预览。

## 开发

前端开发服务器在 8090，Go 服务在 8091，`/api` 由 rspack 代理到 Go：

```sh
# 终端 1
go run ./cmd/chat-deepseek serve --data-dir ./data-dev --listen 127.0.0.1:8091 --no-browser

# 终端 2
pnpm dev
```

打开 http://localhost:8090 。修改前端后热更新；修改 Go 后重启服务。生产构建用 `pnpm build`：构建到 `dist/` 后自动复制到 `internal/webui/dist/`，再由 `go:embed` 嵌进二进制。

| 命令                 | 用途                               |
| -------------------- | ---------------------------------- |
| `pnpm dev`           | 启动前端开发服务器                 |
| `pnpm build`         | 构建前端并复制到 Go 嵌入目录       |
| `pnpm type`          | TypeScript 类型检查                |
| `pnpm lint`          | oxlint 检查                        |
| `pnpm format`        | oxfmt 格式化                       |
| `go test ./...`      | Go 单元/接口测试                   |
| `go vet ./...`       | Go 静态检查                        |

技术栈以 Go、SQLite（纯 Go 驱动）、React 18、TypeScript、rspack、zustand 为主；Markdown 使用 mdast 渲染，公式与图表按需加载 KaTeX / Mermaid。

```text
cmd/chat-deepseek/    Go CLI 入口
internal/             Go 服务端（config/database/account/auth/settings/chat/filestore/backup/deepseek/server/cli/webui 等）
src/                  React 客户端
  app/                应用外壳、认证门、主题
  components/         聊天、设置、登录、Markdown 等界面组件
  i18n/               中英文文案
  services/           服务端 API、会话状态、语音、Markdown
  utils/              通用工具
```

聊天使用 `deepseek-flash`，通过服务端代理 Anthropic 兼容的 Messages / Files API；语音通过服务端代理 ASR / TTS。请求中的搜索、链接阅读、标题和 `latest_reminder` 扩展保持不变。

## 与上游的差异

- 从静态前端改为 Go 服务端 + Web 客户端；`file://` 直接打开不再受支持，必须通过服务端访问。
- 账户、会话、附件、设置和 API Key 移到服务端；不再使用浏览器本地存储。
- 增加 CLI 账户管理、登录/CSRF、服务端文件代理和 SSE 代理。
- 界面品牌改为 `Deepseek`，字标使用 DM Sans；侧边栏与登录页使用 DeepSeek 鲸鱼标志，登录页跟随明暗主题（亮色白底 / 暗色官方风格）。来源与商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- `main` 只镜像上游，日常改造在 `feature/*` 分支进行；分支、版本与协作约定见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)。构建会把许可证复制到产物，分发时请一并保留；第三方依赖遵循各自的许可证，界面鲸鱼标志的来源与商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
