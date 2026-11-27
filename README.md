# chat-deepseek

基于 DeepSeek API 的自托管聊天应用：Go 服务端 + React Web 客户端。账户、会话、附件、设置和 API Key 都保存在服务器上，浏览器只保留登录 Cookie 和内存中的 CSRF token。

本项目是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的 fork，当前版本 `0.1.5-official0.1.4`，代码基线为上游 `v0.1.4`。仓库位于 [GitHub](https://github.com/elegantgx/chat-deepseek)，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 下载与安装

发布页同时提供 Electron 桌面端（便携 zip，解压即用）和 Linux 服务端（headless，用浏览器访问）。macOS/Windows 只发桌面端包，包里带着同一份 CLI；Linux 如果只想下二进制跑服务端，用 `-server` 包。

### Linux

- **服务端**（headless）：下载 `chat-deepseek-<版本>-linux-server-amd64.zip`，解压后运行 `./chat-deepseek`。首次启动会引导创建 Owner，之后在浏览器打开 `http://127.0.0.1:8090`。
- **桌面端**：下载 `chat-deepseek-<版本>-linux-amd64.zip`，解压后运行 `chat-deepseek`，不需要安装。桌面端自带 Go 后端（`resources/bin/chat-deepseek`），数据默认在 `~/.config/chat-deepseek/data`。
- systemd 是**可选的高级功能**：不安装也能用前台进程、tmux、nohup 或其它 supervisor；需要开机自启时再执行 `./chat-deepseek service install --enable`，详见[常驻运行](#常驻运行)。

### macOS

- **桌面端**：`chat-deepseek-<版本>-macos-arm64.zip`，解压后把 `chat-deepseek.app` 拖进「应用程序」。当前**未签名、未公证**：首次打开请在 Finder 里右键应用 →「打开」，再确认「打开」；或先执行 `xattr -cr /Applications/chat-deepseek.app`。只提供 arm64。

### Windows

- **桌面端**：`chat-deepseek-<版本>-windows-amd64.zip`，解压后运行 `chat-deepseek.exe`，不需要安装。包内自带 Go 后端（`resources\bin\chat-deepseek.exe`）；未签名，SmartScreen 提示时点「更多信息 → 仍要运行」。

桌面端和浏览器访问的是同一套本机服务：桌面端在后台启动 `chat-deepseek ipc` 并只监听回环，聊天界面在桌面窗口里；Linux 服务端压缩包则适合服务器、NAS 或只用浏览器的场景。

首次打开桌面端时，数据目录里还没有账户：服务页的「启动服务」会变成「新建用户」，点进去创建第一个用户即可，创建后会自动登录。

## 从源码运行

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

| 命令                          | 作用                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `setup`                       | 创建第一个 `Owner`，只能执行一次                                                      |
| `serve`                       | 前台启动服务（会话模式），`Ctrl+C` 停止                                               |
| `info`                        | 输出版本、路径、配置和 systemd 状态（固定 `key=value`）                               |
| `config set`                  | 修改 `config.json`：`listen`、`public_url`、`api_origin`、`backup_dir`                |
| `service ...`                 | Linux systemd 托管：`install` / `uninstall` / `start` / `stop` / `restart` / `status` |
| `login` / `logout` / `whoami` | CLI 管理登录，按终端隔离，固定 15 分钟过期                                            |
| `user ...`                    | 创建、禁用、授组、重置密码、删除账户                                                  |
| `backup ...`                  | 备份、列出备份、恢复备份                                                              |
| `version`                     | 版本信息                                                                              |

- `info`、`config set`、`service` 不需要应用登录；`service install` 仍要求数据目录已初始化。`info` 只读，不会创建数据库、`config.json` 或 WAL 文件。
- `config set` 只修改指定字段，保留 `config.json` 里的其他字段，文件仍然是 `0600`。修改 `listen`、`public_url`、`api_origin` 后需要重启 `serve`，`backup_dir` 在下次备份时生效。
- 退出码：`0` 成功、`1` 运行错误、`2` 用法错误、`3` 未登录或登录过期、`4` 权限不足。
- `user list`、`whoami`、`backup list`、`info`、`service status` 的文本列是稳定契约；脚本依赖这些格式，改动要同步使用方。

## 发布流水线

`.github/workflows/release-{linux,macos,windows}.yml` 是三个手动触发的 GitHub Actions 工作流：在 Actions 里选择 Release Linux、Release macOS 或 Release Windows，点击 Run workflow；push、标签、Pull Request 和定时任务都不会自动触发。在 tag 上运行会把产物发到同一个 GitHub Release，在分支上运行只保留 Actions artifacts（30 天）。

每个工作流都跑同样的门禁：`pnpm install --frozen-lockfile` → `pnpm type` → `pnpm lint` → `pnpm build`（Web UI 进 `internal/webui/dist`）；然后用 `CGO_ENABLED=0` 构建 Go 二进制（桌面端 `resources/bin` 与 Linux 服务端包复用），`pnpm desktop:build` 编译主进程与渲染层，最后由 electron-builder 出便携 zip。

产物矩阵：

| 平台    | 产物                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------- |
| Linux   | 桌面端 `chat-deepseek-<版本>-linux-amd64.zip`；服务端 `chat-deepseek-<版本>-linux-server-amd64.zip` |
| macOS   | 桌面端 `chat-deepseek-<版本>-macos-arm64.zip`                                                       |
| Windows | 桌面端 `chat-deepseek-<版本>-windows-amd64.zip`                                                     |

- 服务端 ZIP 的版本取自 tag 名（带 `v`）；在分支上手动运行时使用提交的 SHA。Go 二进制通过 `-ldflags "-s -w -X ...buildinfo.Version=${VERSION}"` 注入版本；桌面端 zip 名里的版本取 `package.json`，不含 `v`。
- 三平台都只出便携 zip（不出 NSIS/dmg/AppImage/deb/tar.gz），解压即用；命名带平台与架构，配置见 `electron-builder.yml`。
- Linux 服务端 ZIP 只含二进制与 `README.md`、`LICENSE`、`THIRD_PARTY_NOTICES.md`，不带 GUI 或整份 `src/`。
- 桌面端把 Go 二进制（也是 CLI）放在 `resources/bin/`，macOS 上是 `chat-deepseek.app/Contents/Resources/bin/`；主进程在打包态从 `process.resourcesPath` 解析，开发态仍先看 `CHAT_DEEPSEEK_BIN`，否则用仓库根目录的 `chat-deepseek`。
- 三份 workflow 可以并行；发布步骤对同一 tag 的 Release 创建和上传做 6 次重试，避免同时创建时的竞态。
- macOS 包未签名，首次打开按住 Control 点按应用 →「打开」，或执行 `xattr -cr`；Windows 包未签名，可能出现 SmartScreen 提示。

## 命令行登录

`user ...` 和 `backup ...` 需要先登录。登录态按 shell 隔离：每个终端各自 `login`，互不覆盖；固定 15 分钟后过期，不随命令续期。

```sh
./chat-deepseek login --username owner
./chat-deepseek whoami
./chat-deepseek logout
```

- 只有 `Admin` / `Owner` 能登录；普通 `User` 没有 CLI 管理权限。
- `logout` 只退出当前终端，其他终端不受影响。
- 未登录或登录过期时退出码为 `3`，权限不足为 `4`，便于脚本判断；完整退出码见上面的命令行一节。
- 登录态不写进 `data/`：Linux 在 `$XDG_RUNTIME_DIR/chat-deepseek/sessions/`（tmpfs），macOS 在 `$TMPDIR/chat-deepseek/sessions/`，Windows 在 `%LOCALAPPDATA%\chat-deepseek\run\sessions\`；数据库只保存 token 的 SHA-256。
- 非交互场景用 `--password-stdin`，密码不会出现在命令行参数里。

权限：

| 操作                                                                    | 需要                             |
| ----------------------------------------------------------------------- | -------------------------------- |
| `setup`、`serve`、`version`                                             | 不需要登录；`setup` 只能执行一次 |
| `login`、`logout`、`whoami`                                             | —                                |
| `user list`、`user groups`、创建普通 User、管理普通 User                | Admin 或 Owner                   |
| `user grant` / `user revoke`、操作 Admin/Owner、`backup` 创建/列表/恢复 | Owner                            |

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

`backup restore` 会用备份覆盖这四项；备份里没有的项会被删除，以回到备份时的状态。恢复时会保留 `backups/`。交互式终端会要求输入 `yes` 确认；脚本使用 `--yes`。恢复完成后需要重新启动服务。

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

| 命令                   | 用途                         |
| ---------------------- | ---------------------------- |
| `pnpm dev`             | 启动前端开发服务器           |
| `pnpm build`           | 构建前端并复制到 Go 嵌入目录 |
| `pnpm type`            | TypeScript 类型检查          |
| `pnpm lint`            | oxlint 检查                  |
| `pnpm format`          | oxfmt 格式化                 |
| `go test ./...`        | Go 单元/接口测试             |
| `go vet ./...`         | Go 静态检查                  |
| `pnpm desktop:build`   | 编译 Electron 主进程与渲染层 |
| `pnpm desktop:backend` | 构建随桌面端分发的 Go 后端   |

技术栈以 Go、SQLite（纯 Go 驱动）、React 18、TypeScript、rspack、zustand 为主；Markdown 使用 mdast 渲染，公式与图表按需加载 KaTeX / Mermaid。

桌面端构建、三平台打包与本机 `--smoke` 验收见 [desktop/README.md](desktop/README.md)。

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
- 新增 Electron 桌面端（`desktop/`，Windows/macOS/Linux 安装包），经本机 `ipc` 管理服务；浏览器仍只走 `/api/v1`。
- 界面品牌改为 `Deepseek`，字标使用 DM Sans；侧边栏与登录页使用 DeepSeek 鲸鱼标志，登录页跟随明暗主题（亮色白底 / 暗色官方风格）。来源与商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- `main` 只镜像上游，日常改造在 `feature/*` 分支进行；分支、版本与协作约定见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)。构建会把许可证复制到产物，分发时请一并保留；第三方依赖遵循各自的许可证，界面鲸鱼标志的来源与商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
