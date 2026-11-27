# 开发、验收与发布

> 从 AGENTS.md 拆出：门禁命令、手动冒烟清单、发布流水线、环境限制与历史决策。
> 改完代码按改动范围挑对应条目验证；不要把整份清单当每次必跑项。

## 1. 门禁命令

```sh
pnpm type     # tsc 严格类型检查
pnpm lint     # oxlint
pnpm build    # 构建前端并复制到 internal/webui/dist
pnpm dev      # 前端开发服务器 http://localhost:8090
pnpm format   # oxfmt 全仓库格式化（会改全仓库，只提交自己的文件）
go test ./... # Go 单元/接口测试
go vet ./...  # Go 静态检查
```

开发时先起 Go（8091，`--api-origin` 可指向 mock），再起 `pnpm dev`（8090 代理 `/api`）：

```sh
go run ./cmd/chat-deepseek serve --data-dir ./data-dev --listen 127.0.0.1:8091 --no-browser
pnpm dev
```

> 前端与桌面端渲染层没有自动化测试；Go 有测试。新增前端测试框架前先与用户确认。

## 2. 前端手动冒烟

按改动范围挑选：

1. 未登录显示登录页；登录后加载会话；退出登录回登录页。
2. 设置里保存/更换 API Key、主题、语言、位置、thinking/search，刷新后仍在。
3. 新建对话、发送、流式输出、停止、重新生成、编辑提问、切换版本、继续生成。
4. 上传图片/文档、拖放/粘贴、发送、刷新后仍能显示与下载。
5. 思考/搜索开关、来源面板、链接阅读、引用角标。
6. 移动端布局（<768px）、键盘弹出；历史导入导出、删除全部会话。
7. 生产二进制：`pnpm build` 后 `go build -o chat-deepseek ./cmd/chat-deepseek`，访问 `/` 能看到 UI 与静态资源。

## 3. CLI 与桌面端验收

### 3.1 备份

- 停止服务后 `chat-deepseek backup` 生成 ZIP，`backup list` 能看到，`backup restore --yes` 覆盖 `config.json`、`chat.db`、`master.key`、`files/`。
- 服务运行、存在 `chat.db-wal` / `chat.db-shm` 时拒绝备份与恢复。
- `--backup-dir` > `config.json` 的 `backup_dir` > `data/backups`。

### 3.2 CLI 登录与权限

- `setup` 后未登录执行 `user list` 退出 3；`login` 后 `whoami` / `user list` 正常。
- 同一机器两个终端分别登录不同账户互不影响；`logout` 只退当前终端；过期退出 3。
- Admin 授组、操作 Owner、备份创建/列表/恢复退出 4。

### 3.3 `info` / `config set` / `service`

- `info`：空目录 `initialized=false` 且不创建 `chat.db`/`config.json`/WAL；setup 后 `initialized=true`；配置值、`backup_dir` 默认值与 `--system` 的 `service_*` 正确。
- `config set`：四个 key 正常写入并提示生效时机；未知字段保留；文件 0600；非法值退出 2；`backup_dir` 清空回默认；损坏的 `config.json` 不被覆盖。
- `service`：用临时 `XDG_CONFIG_HOME` + fake `systemctl`/`loginctl`（临时 PATH）验证 user/system unit 内容、未初始化拒绝安装、install 不启动、`--enable`/`--disable`、`--force`、linger 提示、status 解析、不支持平台行为。**不要真的写 `~/.config/systemd/user` 或 `/etc/systemd/system`。**

### 3.4 Electron 桌面端（`--smoke`）

- 开发态：`pnpm desktop:build` 后运行 `XDG_CONFIG_HOME=$PWD/tmp/xdg ./node_modules/.bin/electron desktop/dist/main.js --smoke`，确认渲染层加载、`system.status`、`desktop.openUrl` 拒绝分支并退出 0。
- 打包态：先 `pnpm desktop:backend`，再 `pnpm desktop:pack:linux`；解压 `release/desktop/*.tar.gz` 后用同一个 `--smoke` 跑一次。日志里的 `[smoke] backend binary -> .../resources/bin/chat-deepseek (exists=true)` 说明 `extraResources` 与主进程路径解析都正确。
- 空数据目录首次打开：服务页主操作变为「新建用户」并出现警告条，点击进入账户页；账户页显示
  「创建第一个用户」，提交后自动登录并进入账户列表，随后服务能正常启动。已有 Owner 但未登录时
  仍是登录表单和「启动服务」。
- `--smoke` 窗口始终隐藏；本机验收不要裸跑可见窗口。

## 4. 发布流水线

- `.github/workflows/release-{linux,windows,macos}.yml` 只接受手动触发（Actions → Release … → Run workflow）；push/tag/PR/schedule 不自动运行。
- 三个 workflow 步骤一致：checkout → pnpm 12.23 / Node 24 → `pnpm install --frozen-lockfile --allow-build '!electron-winstaller'` → `pnpm type` → `pnpm lint` → `pnpm build`（Web UI 进 `internal/webui/dist`）→ Go 构建 → `pnpm desktop:build` → electron-builder → 服务端 ZIP → artifact/Release。
- Go 二进制统一由 `scripts/build-desktop-backend.mjs` 构建：`CGO_ENABLED=0`、`-trimpath`、`-ldflags "-s -w -X github.com/elegantgx/chat-deepseek/internal/buildinfo.Version=${VERSION}"`，输出 `desktop/build/backend/bin/chat-deepseek[.exe]`。tag 运行时 `VERSION` 是 tag 名（带 `v`），分支运行是提交 SHA；服务端 ZIP 复用同一份产物。
- 桌面端配置在 `electron-builder.yml`：`appId=com.chatdeepseek.desktop`、`productName=chat-deepseek`、图标取 `desktop/build/whale.{png,icns,ico}`、`extraResources` 把 `desktop/build/backend/bin` 放到 `resources/bin`。输出在 `release/desktop/`，不复用根 `dist/`。
- 平台 target：Linux 只出 `tar.gz`（不出 AppImage/deb），macOS 出未签名 `dmg`（`identity: null`），Windows 出 `nsis`；统一 `--publish never`，发布只由 workflow 的 `gh` 步骤控制。
- 服务端 ZIP：`chat-deepseek-<VERSION>-linux-amd64.zip`、`-macos-arm64.zip`、`-windows-amd64.zip`，根目录只有二进制与 `README.md`、`LICENSE`、`THIRD_PARTY_NOTICES.md`，不再包含 GUI 源码或整份 `src/`。
- 桌面端产物：`chat-deepseek-desktop-<version>-linux-x86_64.tar.gz`、`-macos-arm64.dmg`、`-windows-x64.exe`（NSIS 安装包）；`<version>` 取 `package.json` 的 `0.1.5-official0.1.4`（不含 tag 的 `v`）。
- 三个 workflow 可并行；tag 上运行时把服务端 ZIP 与桌面端安装包一起上传到同一个 Release，创建和上传做 6 次重试，避免同时创建时的竞态。分支运行只保留 artifacts（30 天）。
- 打包会按需下载 Electron、NSIS 与 7zip：Linux 本机与 CI 首次运行需要网络；Windows runner 用原生 NSIS，macOS 用系统 `hdiutil`，不需要额外 Python/PyInstaller。
- Windows 安装包未签名；macOS 包未签名、无公证。
- `internal/webui/dist/*` 是生成物，不提交；只提交 `.gitkeep`。忘记 `pnpm build` 会得到占位页。

## 5. 版本与 tag

- `package.json` 版本 `0.1.5-official0.1.4`；major 跟随上游，带 `official` 后缀。它是合法的 semver 预发布版本，排序在 `0.1.4` 之前，不替代正式版。
- 自己的发布 tag 带 `v`：`v<版本>-official<上游版本>`，例如 `v0.1.5-official0.1.4`，与上游 `vX.Y.Z` 不混用。
- 未明确要求时不要改版本、不要提交 `dist/`。

## 6. 环境限制

- **SSH 配置**：部分 Linux 发行版的系统 `ssh_config` 会因权限过宽导致 `ssh` / `git push` 报 `Bad owner or permissions`；可临时用 `git config core.sshCommand "ssh -F /dev/null"` 绕过。这是本机配置，不要提交。
- **pnpm store**：pnpm 全局 store 默认在 workspace 外，沙箱下 `pnpm type/lint/build` 前的自动安装检查可能报 `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` 或只读文件系统；脚本本身仍会执行并通过。依赖未变可忽略；真要安装可把 store 指到可写目录（如 `--store-dir /tmp/pnpm-store`），尚未验证。
- **Go 缓存**：默认 `GOPATH`/模块缓存在 workspace 外只读；构建/测试需指到 `tmp/`：
  `export GOPATH=$PWD/tmp/gopath GOMODCACHE=$PWD/tmp/gopath/pkg/mod GOCACHE=$PWD/tmp/go-build`。
- **`/tmp` 不跨调用保留**：临时文件放 `tmp/`（已 gitignore）。
- **上游连通性**：`git ls-remote` 可能超时；同步失败先查网络或代理。代理地址属于本机配置，不要写进仓库。
- **分支历史**：`feature/dev` 已推送，不要重写已推送提交；需要改历史先在 GitHub 处理保护设置或换分支。

## 7. 历史决策

- **Docker**：暂不作为一等发布形态。静态二进制 + 内嵌 UI + 纯 Go SQLite 运行时依赖极低，容器化反而要把 CLI 管理面塞进 `docker exec`，与“CLI/OS 是管理边界”冲突。NAS/远程方向是 SSH + 二进制 + 主机 supervisor（systemd、tmux、计划任务）。
- **systemd**：只支持 Linux systemd；默认 user unit，`--system` 需 root/`--run-as`/显式 `--data-dir`；install 只写 unit + `daemon-reload` 不启动；开机自启与立即启动分开；linger 只提示不执行 sudo；不做 daemon/PID、日志命令、静态 unit。
- **`backup_dir` 归属**：放 `config.json`，因为备份是 CLI 能力；`--backup-dir` > config > `data/backups`；`config set` 用原始 JSON map 更新并保留未知字段；`config.json` 会进备份 ZIP。
- **CLI 登录态**：按 shell 隔离、固定 15 分钟；Linux `$XDG_RUNTIME_DIR/chat-deepseek/sessions/`，macOS `$TMPDIR/...`，Windows `%LOCALAPPDATA%\chat-deepseek\run\sessions\`；目录 0700、文件 0600，数据库只存哈希；父进程链 Linux 读 `/proc`、macOS `sysctl`、Windows Toolhelp + `GetProcessTimes`（Windows 真机未验证）。
- **存储迁移**：v1 已移除 localStorage/IndexedDB，旧数据不自动迁移；需保留历史先用旧版导出 ZIP 再导入。
- **README 语言**：只保留中文 `README.md`，英文版已删；README 是用户文档，试错/决策写这里而不是 README。
- **UI 文案**：标题与 `appName` 为 `Deepseek`；字标用 DM Sans 700（OFL），鲸鱼标志来自 Simple Icons（CC0-1.0），来源与商标说明见 `THIRD_PARTY_NOTICES.md`。
