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

GUI：`gui/.venv/bin/python -m unittest discover -s gui/tests`；`gui/.venv` 不提交，依赖从清华源安装。

> 前端没有自动化测试；Go 与 GUI 有测试。新增前端测试框架前先与用户确认。

## 2. 前端手动冒烟

按改动范围挑选：

1. 未登录显示登录页；登录后加载会话；退出登录回登录页。
2. 设置里保存/更换 API Key、主题、语言、位置、thinking/search，刷新后仍在。
3. 新建对话、发送、流式输出、停止、重新生成、编辑提问、切换版本、继续生成。
4. 上传图片/文档、拖放/粘贴、发送、刷新后仍能显示与下载。
5. 思考/搜索开关、来源面板、链接阅读、引用角标。
6. 移动端布局（<768px）、键盘弹出；历史导入导出、删除全部会话。
7. 生产二进制：`pnpm build` 后 `go build -o chat-deepseek ./cmd/chat-deepseek`，访问 `/` 能看到 UI 与静态资源。

## 3. CLI / GUI 验收

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

### 3.4 GUI 基本流程

用临时 `XDG_CONFIG_HOME` 和数据目录启动：四页可切换；未登录时徽标为 `—`、账户/备份页显示锁态与登录入口；Owner 登录后账户页键盘可用（`↑`/`↓`/空格/`Enter`），添加/重置密码/授组/撤组/禁用/启用/删除可用；Admin 登录后授组、备份、操作 Owner 置灰，只能管理 User、不能禁用/删除自己。备份页在服务运行时提示先停机且停止需二次确认，停止后“立即备份”生成 ZIP，恢复确认复述覆盖范围。设置页连接卡“测试连接/应用切换”可用，服务端配置卡逐项保存后 `config.json` 与 `info` 一致，带未应用改动离开先确认；服务页 `⋯` 有安装/更新/卸载与命令行帮助。关闭 GUI 后会话文件消失；确认密码不出现在命令行与输出。

### 3.5 GUI 配置迁移与服务安装

- v1/v2 `config.gui.json` 启动后变 v3（`local` + `ssh`），旧 `backup_dir` 写进 `config.json`。
- fake `systemctl`/`loginctl` 下走“安装服务”：切到系统目录只出现“安装命令”和“CLI 帮助”两条单行字段与复制按钮，命令含 `sudo ... service install --system --run-as <user>`，不执行；切回用户目录安装，确认 `--enable`、`start` 调用与 linger enable/disable；再走更新（可调开机自启、`--force` + `restart`、缓存过期也真正重启、失败弹错误）、停止、重启、卸载；确认关闭 GUI 不停止 systemd 服务。

### 3.6 GUI SSH

- 临时 `XDG_CONFIG_HOME` + fake `ssh`（`exec /bin/sh -c "$last"`）+ fake 远端 `chat-deepseek`；`connection=ssh`、`ssh.host` 为 fake 别名、`ssh.binary_dir` 指向 fake 目录。
- 无头 Qt 确认：`info` 回填远端 data_dir、版本标签带 SSH 主机、`remote_user` 取自 `id -un`。
- 设置页切到 SSH 后“应用切换”：两套路径行按方式显隐，与服务端配置卡同页不重叠。
- login/whoami/logout：密码经 here-doc、登录态跨命令复用、关闭后远端会话文件消失；fake ssh 断开/sleep 时返回 255、提示重新登录、下一条命令重连。
- SSH 模式启动服务再停止：远端进程退出、端口释放（`ssh -T` 不发 SIGHUP，只杀本地 ssh 会留孤儿进程）；备份页隐藏“备份到…”，打开页面只认远端 Public URL。
- 备份地址来自远端 `config.json`，刚连上、`info` 未返回时不显示本机路径；服务端四项保存后重读 `info`，切回本机再切回 SSH 仍各自正确。
- 登录后切换连接方式：旧目标 `auth_sessions` 行被 `logout` 清掉（本机与远端各测一次）。
- 真机再对一台 Linux/NAS 跑 `info`、`service install`、`service start`、linger 提示与 `open_page`（仅 Public URL）。

## 4. 发布流水线

- `.github/workflows/release-{linux,windows,macos}.yml` 只接受手动触发（Actions → Release … → Run workflow）；push/tag/PR/schedule 不自动运行。
- 每个 workflow 在原生 runner 完成 Web 构建、Go CLI 编译与 ZIP；Windows/macOS 额外 PyInstaller GUI。统一 pnpm 12.6、Node 24；Windows/macOS 用 Python 3.13、PyInstaller 6.22.3。
- Linux 只构建 CLI（onefile 绑定构建机 glibc），包根目录含 `chat-deepseek`、`gui/`（源码副本）、`src/`（`git archive HEAD`）与三份文档；Windows 额外含预编译 GUI；macOS 只产出 DMG（`.app` + `/Applications` 链接），CLI、模板配置与文档在 `.app/Contents/Resources`。
- 打包排除 `data/`、`node_modules/`、`gui/.venv` 与构建产物；Windows 不跑 `pnpm build`（脚本含 `rm -rf` 与 Unix 环境变量），改跑 `pnpm exec rspack build` + `node scripts/embed-ui.mjs`。
- tag 运行时上传到同一个 GitHub Release，分支运行只保留 artifacts；三个 workflow 可并行，Release 创建/上传做重试。
- Windows 未签名；macOS 仅 ad-hoc 签名，无公证。
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
- **GUI 登录态**：复用 CLI 同一套会话，但启动不继承父 shell，关闭自动 `logout`。
