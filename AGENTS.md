# AGENTS.md

> 本文件记录项目现状与协作约定，会作为工作区上下文注入给每个 agent。
> 改造前先读这里，再读相关模块；修改完成后更新受影响的章节。

## 1. 项目是什么

- 项目：`chat-deepseek`，本地目录 `chat-deepseek`，版本 `0.1.4-official0.1.4`，MIT。
- 来源：`https://github.com/deepseek-ai/chat-demo.git` 的克隆。远程 `upstream`（原 `origin`）指向上游，`origin` 指向自己的 GitHub fork `git@github.com:elegantgx/chat-deepseek.git`（SSH）。
- 分支策略：`main` 只镜像上游、不在上面开发；日常改造在 `feature/*` 分支进行，定期把 `main` 同步到上游后合并进 feature 分支，再推送到 `origin`。
- 定位：**Go 自托管服务端 + React Web 客户端**；服务端保存账户、会话、附件、设置和 API Key，浏览器不再保存聊天或 Key，也不再使用 localStorage/IndexedDB。
- 能力：服务端账户登录、多会话与消息分支、流式回复、深度思考、联网搜索与链接阅读、附件上传、Markdown / 代码高亮 / KaTeX / Mermaid、中英双语、明暗主题、移动端、语音输入与朗读、历史导入导出。
- 技术栈：React 18.3.1、TypeScript 7.0.2（strict）、rspack 2.0.2（SWC + lightningcss）、zustand 4.4.7、fflate、mdast / micromark、katex、prismjs、mermaid；服务端 Go 1.27+、SQLite（`modernc.org/sqlite`）、Argon2id、AES-GCM。
- 运行环境：Node.js 22.12+、pnpm、Go 1.27+。前端开发端口 `8090`，Go 服务开发端口 `8091`。
- 部署形态：便携式二进制（`go:embed` 内嵌 Web UI）+ 同级 `data/` 目录，由普通用户运行；不要求 root、不写 `/var`、不依赖 systemd。只能通过 HTTP 访问，`file://` 静态形态已不再支持。

## 2. 当前状态（2026-11-26 核验）

- 改造状态：v1 主链路可用。Go 服务端具备账户/组、登录/CSRF、设置与 API Key 加密、会话版本锁/永久删除、附件存储、DeepSeek Files/SSE/ASR/TTS 代理和 Web UI 嵌入；前端已登录门、设置、会话、附件全部走 `/api/v1`，localStorage/IndexedDB 已移除。
- Git：当前在 `feature/dev`；`main` 跟踪 `upstream/main`，`feature/dev` 跟踪 `origin/feature/dev`；`AGENTS.md` 提交在 feature 分支。已合并上游 `v0.1.4`（合并提交 `7e88ec5`）。
- `pnpm type`：通过。
- `pnpm lint`：通过，`0 warnings and 0 errors`（约 132 个文件）。
- `pnpm build`：通过，生成 `dist/` 并复制到 `internal/webui/dist/` 供 `go:embed`。
- CLI 管理登录：`login` / `logout` / `whoami` 按 shell 隔离、固定 15 分钟；`user ...` / `backup ...` 按 Owner/Admin 校验，退出码 `3` 未登录、`4` 权限不足。GUI 已适配：未登录时账户页和备份页显示锁态与登录入口，点登录/刷新/添加/备份会弹登录框；按钮按 Admin/Owner 权限置灰，关闭 GUI 自动 logout。
- CLI 契约：新增 `info` / `config set` / `service`（仅 Linux systemd，默认 user unit，`--system` 需 root，`service --help` 列出子命令）；`backup_dir` 进入 `config.json`，`backup` / `list` / `restore` 按 `--backup-dir` > config > `data/backups` 解析；`info` 与 `service status` 输出固定 `key=value`，退出码补齐用法错误 `2`。
- 测试：Go 单元/接口测试覆盖 auth、account、database、config、secret、settings、chat、filestore、backup、deepseek、server、service、cli；新增 `info` / `config set` / `service` 契约测试和 fake systemd 测试；`go test ./...`、`go vet ./...`、Windows/macOS 交叉编译通过。前端没有自动化测试。
- 手动端到端：已用临时数据目录 + dev 代理走通登录、退出、设置/API Key、会话创建/加载/刷新持久化、附件上传和 SSE mock 回复；侧边栏 Logo、头像菜单、Deepseek 标题与 favicon 已在无头 Chrome 验证（桌面与移动端），登录页明暗两套样式、DM Sans 字标和首页鲸鱼也已核对；系统设置已按官方左右分栏与行式列表重做，账户资料保存后就地更新且不关闭弹窗；桌面与移动端均已在无头 Chrome 核对；删除会话、清空全部会话和移除草稿附件后，`files` 表、磁盘原件和空用户目录均已核对清理；历史导出后重新导入会重映射附件 ID 并原子替换会话，导入进度按已处理会话数显示；`backup` 在服务运行时拒绝、停止后生成 ZIP。上游 v0.1.4 的导入进度、带图片归档的 MIME 回填与损坏 ZIP 失败保护已在无头 Chrome 核对（11 个会话 + 1 张 PNG；失败时旧会话和图片保持不变）。
- 代码规模：`src` 约 21k 行（含 CSS Modules）；最大文件是 `src/services/chat/store.ts`（约 1.1k 行）。
- GUI：`gui/app.py` 是 46 行薄入口（QApplication、主题、bootstrap、事件循环），界面逻辑在 `gui/cdgui/`。分层：`domain/`（Target/AppState/reducers/rules/commands/validation，纯 Python 不依赖 Qt）、`infra/`（process/transport/ssh/gateway/runner/serve/errors/persistence，唯一执行命令、起线程和持有 SSH 通道的地方）、`store.py`（AppState + 不变量 + 订阅）、`controller.py`（流程编排、代际、超时与关闭顺序）、`ui/`（main_window/render/views/protocols/pages/primitives/forms/dialogs/tokens/palette）、`bootstrap.py`（配置 → Target → Transport → Controller → 窗口）。`parsing.py` 解析 CLI 中文输出，`gui_config.py` 读写 v3 `config.gui.json`（`connection`、`local`/`ssh` 两段、用户名，v1/v2 自动迁移），`server_config.py` / `service_plan.py` 提供默认路径与 systemd 命令。窗口左侧四页：服务 / 账户 / 备份 / 设置。服务页是 1 个主操作（启动/停止，未初始化时“创建 Owner”）+ 重启/打开页面 + `⋯` 溢出菜单（安装/更新/卸载服务、命令行帮助），下面是运行详情（数据目录、安装位置、linger 命令与徽标）和仅前台会话显示的日志；账户页是 60px 成员行（头像、用户名、组标签、状态点），支持 `↑`/`↓`/空格/`Enter`，底栏做重置密码、禁用/启用、授组/撤组、删除；备份独立成页，服务运行时先显示“备份需要先停止服务”并单独二次确认停止，记录列表可恢复并复述覆盖的文件；设置从弹窗改成页面，连接卡（本机/SSH、两套路径、测试连接、应用切换）和服务端配置卡（备份/监听/Public URL/API、保存配置）各自提交，另有管理登录和关于卡。导航账户/备份徽标未登录显示 `—`，登录后显示数量，服务项显示状态点。登录仍走 CLI `login`，密码只经 stdin（远端 here-doc），15 分钟过期，关闭 GUI 自动 `logout`；仅 Admin/Owner 可登录，Admin 不能授组、备份或操作 Owner，Owner 也不能禁用/删除自己。Linux + systemd 用户级直接安装，系统级只生成“安装命令”和“CLI 帮助”不执行；远端用常驻 `ssh -T <host> 'exec /bin/sh'`，登录态跟着 shell，255 提示重连，远端前台 serve 按 PID `SIGTERM`，备份/监听/Public URL/API 只认当前 target 的 `config.json`，远端不提供“备份到…”和 SFTP。GUI 单元测试共 627 个通过，覆盖 domain、infra（含 fake ssh / fake CLI）、controller、store、窗口骨架、四页、对话框、bootstrap、配置迁移、解析器和架构守卫（`test_architecture.py` 用 ast 锁住分层、QGridLayout 归属与旧模块）。
- 源码中没有 `TODO` / `FIXME` 标记。

## 3. 目录与关键文件

```text
.github/workflows/         手动发布流水线（Linux / Windows / macOS 各一个）
src/
  main.tsx                    启动：setupTheme、ensureKatex、createRoot(<App/>)
  app/                        应用外壳、主题、视口与全局样式
    Root.tsx                  认证门：/auth/me → 加载设置 → App 或登录页
    App.tsx                   侧边栏 / 主区域 / 设置弹窗 / Toast 的组装
    theme.ts                  明暗主题（支持跟随系统），body class + theme-color
    viewport.ts               移动端断点（<768px）、键盘视口、阻止整页滚动
  components/
    base/                     Button、IconButton、Menu、Modal、Select、Toast、Tooltip、Avatar、icons、WhaleLogo
    chatInput/                输入框、草稿附件、拖放、语音按钮、录音频谱
    messages/                 MessageList、UserMessage、AssistantMessage、ReplyArea（思考/搜索步骤时间线）、BranchSwitcher、CopyButton、ReadAloudButton
    markdown/                 Markdown（节流 → mdast → 渲染）、AST 渲染器、代码高亮、KaTeX、Mermaid
    search/                   搜索结果面板、来源卡片、悬浮卡、引用角标
    auth/                     LoginView（服务端账户登录）
    session/                  SessionView（标题 + 消息列表 + 吸底输入框）、Welcome、MobileHeader
    settings/                 SettingsDialog（通用 / 账户 / 数据 / 关于）、SettingRow、账户管理、关于、API Key 编辑、弹窗状态
    sider/                    会话侧边栏、移动端抽屉、折叠态
    files/                    附件卡片、文件图标、文件预览
  i18n/                       zh.ts（key 的源头）、en.ts（satisfies 同一组 key）、index.ts
  services/
    api/                      client.ts（fetch / SSE / Files）、types.ts（协议类型）、sse.ts、parseEvent.ts、errors.ts、speech.ts（ASR/TTS）
    chat/                     store.ts（会话状态与全部动作）、types.ts、reply.ts、branches.ts、view.ts、describe.ts、db.ts（服务端会话/附件适配）、drafts.ts、backup.ts、latestReminder.ts、sessionGroups.ts
    chat/history/             历史归档格式、校验、ZIP 读写、导入导出（细节见该目录 README.md）
    attachments.ts            上传队列、限额、purpose、错误文案
    settings.ts               服务端偏好的 zustand 镜像与防抖保存
    location.ts / locationData.ts  地区数据
    uploadExts.ts             附件扩展名白名单（约 1k 行）
    markdown/                 parse、highlight、katex、mermaid
    speech/                   recorder（录音）、readAloud（TTS 播放）
  utils/                      id、format、url、clipboard、图片缩放、头像处理
  assets/                     favicon.svg、DM Sans 字体与 OFL 许可证
  env.d.ts                    CSS Modules / prismjs / katex 的模块声明

gui/                         Python/PySide6 管理界面（.venv 不提交）
  app.py                     46 行入口：QApplication、主题、bootstrap、事件循环
  cdgui/
    bootstrap.py             读配置 → Target → Transport → Controller → 窗口
    controller.py            流程编排、代际、超时、关闭顺序
    store.py                 AppState 容器、不变量与订阅
    domain/
      target.py              Endpoint、Target、Capability、resolve_target
      facts.py               HostConfig、ServiceStatus、ForegroundSession
      state.py               AppState、PageId、TaskKey、Notice、assert_invariants
      reducers.py            全部 (AppState, Event) -> AppState 纯函数
      rules.py               is_running、page_url、backup_reason、action_verdict
      commands.py            CommandSpec 与 CLI argv（密码只放 stdin）
      validation.py          密码、URL、远端绝对路径等校验
    infra/
      process.py             本机子进程与 find_binary
      transport.py           Transport、LocalTransport、SshTransport
      ssh.py                 SSH 常驻通道（握手、哨兵、here-doc、断线）
      gateway.py             CliGateway：info/login/whoami/user/backup/service
      runner.py              CommandRunner、CancelToken、主线程泵
      serve.py               ServeHandle / ServerProcess
      errors.py              退出码归一化与 CommandError
      persistence.py         GuiConfigRepository（原子保存）
    ui/
      main_window.py         顶栏、导航、四页 QStackedWidget、状态栏、关闭确认
      render.py              AppState -> UiState 投影与幂等 apply
      views.py               控件引用容器与外壳尺寸
      protocols.py           ControllerProtocol
      login_sheet.py         登录对话框
      pages/                 服务 / 账户 / 备份 / 设置
      primitives/            Surface、Badge、Button、Field、Switch、Avatar、ListRow 等
      forms.py               FormGrid / FormRow / PathRow / CopyRow
      dialogs/               账户、密码、组、确认、消息、服务安装/更新
      tokens.py              间距、圆角、字号、高度与最小宽度
      palette.py             tone -> 颜色
  parsing.py                 CLI 中文输出解析（稳定契约）
  server_config.py           计算默认路径与默认监听/API 地址
  service_plan.py            生成 systemd unit 路径与 service 命令（含远端前缀）
  gui_config.py              读写 v3 config.gui.json（连接方式、local/ssh、用户名）
  fonts.py                   系统 UI 字体选择
  theme.py                   明暗配色、字号与全局样式表
  assets/                    whale.svg（Simple Icons，CC0-1.0）、whale.ico、whale.icns、whale.png
  tests/                     domain / infra / controller / store / 窗口 / 四页 / 对话框 / bootstrap / 配置解析 / 架构守卫
  requirements.txt
  README.md
  REFACTOR_PLAN.md           重构方案（已实施，保留设计依据）
  BEHAVIOR_BASELINE.md        重构验收行为基线（已对照）
  .gitignore                 忽略 .venv / __pycache__
cmd/chat-deepseek/            Go CLI 入口（v1 服务端，见 §13）
internal/
  config/                     数据目录、config.json 与 DeepSeek API 地址
  database/                   SQLite 打开与 schema 迁移（当前 v5）
  account/                    账户、固定组、最后 Owner 保护
  auth/                       Argon2id、session、CSRF
  secret/                     master.key 与 AES-GCM
  settings/                   每用户偏好与加密 API Key
  chat/                       会话 JSON、版本锁、永久删除
  filestore/                  附件原件与元数据
  backup/                     数据目录 ZIP 备份、列表与恢复
  service/                    Linux systemd unit 生成与 systemctl/loginctl 调用
  deepseek/                   Files / Messages / ASR / TTS 上游客户端
  server/                     /api/v1 认证、设置、会话、文件、SSE/语音代理与静态 UI
  webui/                      go:embed 的 Web 构建产物（dist/.gitkeep 占位）
  cli/                        setup/serve/backup/user、login/logout/whoami、info/config/service、会话与权限守卫
```

`README.md` 是唯一面向用户的功能、运行与数据说明（中文）；英文版已删除，不要恢复双语结构。`src/services/chat/history/README.md` 是历史导入导出的详细设计文档。改功能时同步更新对应文档。

Go 代码遵循 `gofmt`；服务端包不写全局状态，CLI 负责装配依赖。新增 Go 代码尽量放在 `internal/`，与上游 TS 分开，方便合并。

## 4. 数据模型与本地存储

### 4.1 消息模型（`services/chat/types.ts`）

- `Session`：`id`、`title`、`createdAt`、`updatedAt`、`messages`、`rootMessageId?`。
- 消息树：每条消息可带 `parentId` / `selectedChildId`。`rootMessageId === undefined` 表示旧版线性列表；`null` 表示空会话。当前展示与请求上下文都由 `getVisibleMessages()` 沿 `selectedChildId` 走出**当前分支**。
- `UserMessage`：`content` + `files: FileAttachment[]`。
- `AssistantMessage`：`model`、`thinking` / `search`（本次请求开关）、`latestReminder`（系统信息快照）、`prefix`（能否作为续写前缀）、`status`（`pending | streaming | done | stopped | error`）、`blocks`（`thinking`、`text`、`server_tool_use`、`web_search_tool_result`、`web_fetch_tool_result`）、`stopReason`、`stopDetails`、`usage`、`error`。
- 附件：`id` 同时是服务端文件 ID（上传时由前端生成并提交）；`serverId` 也是服务端文件 ID，服务端代理时再换成 DeepSeek `file_id`。`isImage` 决定上传 purpose 与请求中的块类型；`imageSizeChecked` 表示当前图片副本已确认长边合规。

### 4.2 持久化

- SQLite 是唯一数据源：`groups`、`users`、`user_groups`、`auth_sessions`、`chats`、`files`、`user_settings`。
- `auth_sessions.scope` 区分 `web` / `cli`，浏览器 Cookie 和 CLI token 不能互相冒用；CLI 登录态本体在用户运行时目录，数据库只存 token 的 SHA-256。
- 会话以完整 `Session` JSON 保存在 `chats.data`；`version` 由服务端递增，客户端在 `db.ts` 内存 map 里维护当前版本，同一会话的保存按队列串行执行。
- 会话列表只返回摘要；详情按需加载，内存缓存上限 `SESSION_CACHE_LIMIT = 5`，淘汰时避开当前会话、生成中、未保存、删除中的会话。
- 附件原件在 `data/files/<user_id>/<file_id>`，元数据在 `files` 表；上传接口使用前端附件 ID 做幂等键，同一用户重复上传会覆盖，其他用户占用同一 ID 会返回冲突。删除附件会同时删除元数据和磁盘原件；最后一个附件删除后移除空用户目录，启动时也会清理遗留空目录。
- 草稿只存在内存（`drafts.ts`，按 `string | null` 区分会话 / 新对话），刷新即丢失。
- 保存失败会中断当前落盘并在界面顶部显示重试条；`version` 409 表示会话已被其他窗口更新，需要刷新后重试。

### 4.3 历史归档

- 格式 `export_format_version: 3`，ZIP 内容：`manifest.json`（首条）、`chat_sessions/{id}.json`、`chat_session_index.json`、`chat_sessions/{id}_files/...`（仅图片原件）。
- 导入先校验格式版本，按会话分批读取 ZIP（会话 JSON 与对应图片一起处理）并写入浏览器内存暂存，进度按已处理会话数回调；确认后给附件换新 ID 并上传，再由服务端 `POST /import` 在一个事务里替换全部会话。失败只清理新上传文件，旧数据保持不变。
- 导出只包含当前分支与能从服务端下载的图片原件；不包含 API Key / 设置 / 非图片附件原件。
- 导入/导出/全部删除由 `backup.ts` 串行队列执行；全部删除会永久删除该用户的服务端会话，并清空附件目录。
- 详细规则见 `src/services/chat/history/README.md`，改动格式必须同步改文档与 `format.ts` / `schema.ts`。

## 5. API 与协议

- 浏览器只访问同源 `/api/v1`；DeepSeek 请求全部由 Go 服务端代理，前端没有 API Key，也没有 `__API_ORIGIN__` 构建常量。
- 认证：`POST /auth/login` 设置 HttpOnly Cookie（scope `web`）；CLI 登录复用 `auth_sessions` 但 scope 为 `cli`，两种 token 不能互换；`GET /auth/me` 返回 `user`（含 `avatar`）、`csrf`、`expiresAt`、`hasApiKey`；`POST /auth/logout`、`POST /auth/password`、`PUT /auth/username`、`PUT /auth/avatar`。登录接口用同源校验；登录后的非 GET 请求需要 `X-CSRF-Token`，登录限流按 IP + 用户名。
- 设置：`GET/PUT /settings` 读写偏好 JSON；`PUT /settings/api-key` 保存加密 Key，`DELETE /settings/api-key` 清除，`POST /settings/api-key/verify` 用候选 Key 调 DeepSeek `/models` 校验。任何响应都不返回 Key 明文或密文。
- 会话：`GET /chats`、`POST /chats`、`GET/PUT/DELETE /chats/{id}`。PUT body 为 `{session, version}`，版本不匹配返回 409；`DELETE` 永久删除会话，并清理不再被其他会话引用的附件。
- 导入：`POST /import` body 为 `{sessions: [...]}`，在单个 SQLite 事务里替换当前用户全部会话；附件必须提前用新 ID 上传，成功后清理旧会话不再引用的附件。
- 文件：`POST /files`（multipart：`id`、`purpose`、`isImage`、`file`）、`GET/DELETE /files/{id}`、`DELETE /files` 清空当前用户附件。上传 ID 由前端生成，服务端按用户幂等覆盖；删除会同时移除元数据和磁盘原件。
- 流式：`POST /stream` 接收 Anthropic Messages 请求体；服务端注入 API Key、强制 `stream: true`、把本地附件 ID 惰性上传并替换成 DeepSeek `file_id`，然后把上游 SSE 原样转发。上游非 2xx 的状态和响应体透传，前端据此分类。
- 语音：`POST /speech/asr` 转发 multipart，`POST /speech/tts` 转发 JSON 并返回裸 PCM（24 kHz、单声道、16-bit 小端）。
- 上游协议仍是 Anthropic 兼容 Messages：请求体含 `model`、`system`、`messages`、`thinking`、`tools`、`safety_check: { level: 'high' }`，无标题时加 `title`；模型固定 `deepseek-flash`。SSE 解析与事件合并仍在前端 `api/sse.ts`、`api/parseEvent.ts`、`chat/reply.ts`。
- 错误统一为 `ApiError`（`http | stream | network | interrupted | protocol`），`api/errors.ts` 负责分类；**分类不直接生成文案**，各场景自己选 i18n key。会话过期 401 会触发整页回登录；DeepSeek 透传的 401 不触发。

### CLI 契约

- 文本输出就是内部契约，不加 `--json`：`user list` 表头、`whoami` 的 `username\tgroups\texpires`、`backup list` 的 `NAME\tSIZE\tTIME`、`backup` 的 `备份已写入 <path>`、`serve` 的启动前缀、`version` 格式都冻结。
- `info` 输出固定顺序的 `key=value`（version/os/arch/binary/data_dir/initialized/listen/public_url/api_origin/backup_dir/service_*）；`service status` 输出其中的 `service_*` 七项。`info` 只读，不创建数据库、`config.json` 或 WAL。
- 退出码：`0` 成功、`1` 运行错误、`2` 用法错误、`3` 未登录/过期、`4` 权限不足。
- `info` / `config set` / `service` 不需要应用登录；`service` 仅 Linux systemd，默认 user unit，`--system` 需要 root、`--run-as` 和显式 `--data-dir`；`service --help` 列出全部子命令。
- 文本格式变更必须同步 `gui/parsing.py`、GUI 测试和 README。

## 6. 核心流程

### 6.1 启动与会话切换

1. `main.tsx`：`ensureKatex()`、`setupTheme()`、渲染 `<Root/>`。
2. `Root` 调 `getMe()`：未登录显示登录页；已登录先 `loadSettings()`，再挂载 `<App/>`。登录成功或退出登录都整页重载，清空上一账户的内存状态。
3. `App` 调 `initChat()` 从 `/api/v1/chats` 读取会话摘要；没有 API Key 时 `ensureApiKey()` 打开设置的数据管理分组。
4. `selectSession()` 只设置 `activeId` 并触发懒加载；加载中用 `historyEpoch` 防止旧请求覆盖新状态。
5. 打开会话时把上次未结束的 `pending/streaming` 回复结算为 `stopped`，再写回服务端。

### 6.2 发送一条消息

1. 输入框内容与附件进入内存草稿；添加附件时立即校验（扩展名 → 大小 → 数量）并上传到 `/api/v1/files`（最多 3 个并发，按附件本地 id 复用上传任务）。附件 ID 由前端生成，同时作为服务端文件 ID。
2. `sendMessage(sessionId | null)`：要求所有附件上传完成；没有会话则新建；通过 `appendBranch` 把「用户消息 + 空的助手消息」挂到当前分支末尾；先 `persist` 到服务端，再清空草稿，最后异步 `streamReply`。
3. `streamReply`：
   - 注册 `AbortController` 到 `streaming`，用 `requestAnimationFrame` 合并流式更新；
   - `prepareFiles` 补齐 `serverId`：本轮附件失败则整体失败（可重试）；历史附件失败静默跳过；旧图片先检查长边，超限则清空 `serverId` 让它重新上传。服务端代理只认本地附件 ID，上传时会把本地原件惰性传给 DeepSeek 并缓存远端 ID。
   - 生成本轮 `latestReminder`；由 `toRequestMessages` 组装上下文；
   - 逐个消费 SSE 事件，`applyEvent` 累积思考 / 正文 / 引用 / 工具块；
   - `message_delta` 中若带标题且会话仍无标题，写入自动标题（用户手动重命名后取消本轮标题）；
   - 结束、失败、停止都经 `settleReply` 收尾并落盘；`finally` 中移除 `streaming`。
4. DeepSeek 判定 `file_id` 失效时，前端清掉对应附件的 `serverId`，重新上传（同一本地 ID 会覆盖服务端文件并清空远端缓存）后重发，最多 2 次退避重试；已收到内容块后不自动重发。代理返回的上游错误可能点名远端 ID，识别不到本地 ID 时应退化为重置本轮全部附件。

### 6.3 重新生成 / 编辑 / 版本切换 / 续写

- `regenerateReply`、`editMessage` 都是在同一父节点下**新增兄弟版本**，不覆盖旧回答和后续对话；`appendBranch` 更新 `selectedChildId`。
- `selectMessageVersion` 只允许切换当前分支路径上节点的兄弟版本；生成中禁止切换。
- `continueReply` 复用原助手消息，把新流追加到已有 `blocks` 后；只有 `canContinueReply` 为真（`prefix`、非拒绝、非 `tool_use`、无服务端工具块、无模板、状态为 `stopped` 或 `done + max_tokens`）才允许。
- 历史上下文只取「用户消息 + 可用助手回复」成对轮次；可用 = `done`/`stopped`、非拒绝、非模板、正文非空。历史思考与引用不回传，历史工具块只回传 `read_link`（且要求有签名）。

### 6.4 界面派生

- `buildReplyView()` 把 `blocks` 换算成：工具步骤时间线（思考 / 搜索 / 打开网页 / 页内查找 / 阅读链接）、最终正文 markdown（插入 `[citation:N]`）、来源列表、搜索结果汇总。
- `useReplyView` 只在来源真正变化时更新数组，避免流式正文导致 Markdown 反复解析。
- Markdown 链路：节流 → `toMdAst` → `MarkdownAstRenderer`；代码高亮、KaTeX、Mermaid 按需加载。
- 语音：输入框录音 → ASR 返回全文并插入光标处；朗读把回复正文转成 TTS PCM，用 `AudioContext` 顺序排程播放，同一时间只读一条，切会话 / 发送 / 停止生成时中断。

### 6.5 历史替换

`replaceHistory(write)`：置 `importingHistory` 锁 → 中止所有生成 → 等删除任务与流收尾 → 递增 `historyEpoch` → 清暂存 → 执行写入 → `commitStaging` 换新附件 ID、上传并调用 `POST /import` 原子替换会话 → 重置会话缓存与草稿。失败路径会清理暂存和新上传文件，旧会话保持可用。

## 7. 技术约定（改动时必须遵守）

### 代码风格

- 格式由 oxfmt 决定：单引号、**不写分号**、`trailingComma: es5`、`printWidth: 100`、2 空格缩进。提交前跑 `pnpm format`（会改全仓库，注意只提交自己的文件）。
- 模块导入带扩展名且写成 `.js`（TypeScript `moduleResolution: NodeNext`）：`import { x } from './x.js'`，`.tsx` 同样写 `.js`。
- 类型导入用 `import type`；`strict`、`noUnusedLocals`、`noUnusedParameters`、`noImplicitReturns` 全开。
- oxlint 关键规则：禁止 default export（`rspack.config.ts` 是唯一例外）、禁止 `console`（除已有内联豁免）、禁止 import 循环、禁止 `any`、禁止非空断言等。
- 注释与文档使用中文，解释「为什么」而不是复述代码。
- 相对路径导入，不引入未使用的路径别名。

### React / 状态

- 全部函数组件；流式链路上的列表项、消息组件使用 `memo`，`memo` 必须具名函数表达式（`react/display-name`）。
- 全局状态用 zustand：`services/settings.ts`、`services/chat/store.ts`、`services/chat/drafts.ts`、`services/attachments.ts`。服务模块导出动作函数，组件用 selector 订阅最小状态。
- 局部 UI 状态留在组件内（如展开/收起、滚动跟随）；跨组件的短暂 UI 状态放 `xxxState.ts`（如 `settingsDialogState.ts`、`searchPanelState.ts`、`mobileSiderState.ts`）。
- 不要绕过 store 直接改 `sessionCache` / `sessions`；所有写操作走 `store.ts` 里的动作，保证持久化、摘要同步与并发保护。

### 样式

- CSS Modules：默认导出，`import styles from './X.module.css'`；class 用 camelCase。rspack 中 `namedExports: false`，`localIdentName: '[local]-[hash:6]'`。
- 设计令牌是 CSS 变量：`--dsw-*`（颜色 / 字体等）、`--ds-*`（控件尺寸、动效等）；主题切换通过 `body[data-ds-dark-theme]` 与 `body.dark`。
- 移动端断点固定 `< 768px`（`app/viewport.ts`）；输入框、顶栏、视口高度依赖 `--app-viewport-*` 变量，改布局时不要破坏键盘弹出行为。
- 全局样式在 `app/global.css` / `app/theme.css`，组件样式就近放 `*.module.css`。
- 注意：`Button.module.css.d.ts`、`Select.module.css.d.ts`、`Settings.module.css.d.ts`、`Sider.module.css.d.ts` 是手写的 CSS Modules 类型声明，会覆盖 `env.d.ts` 的通用声明；给这四个模块新增 class 时要同步补 `.d.ts`，否则 `pnpm type` 报错。

### 文案与可访问性

- 所有用户可见文案走 i18n：`zh.ts` 定义 key，`en.ts` 用 `satisfies Record<keyof typeof zh, string>` 保证齐全。不要在组件里硬编码中文 / 英文。
- 图标按钮提供 `aria-label`；状态变化用 `role="status"` / `aria-live`；弹窗、菜单、选择器保留键盘操作与焦点管理。
- 外链统一 `target="_blank" rel="noreferrer"`；Markdown 渲染不允许裸 HTML 注入（当前走 AST 渲染，不要改成 `dangerouslySetInnerHTML`）。

### 数据与兼容

- 不再引入 localStorage / IndexedDB；设置、会话、附件、API Key 都以服务端为准。
- 会话 `version` 由服务端维护，客户端 `db.ts` 按会话串行保存；收到 409 时不要静默覆盖，提示用户刷新。
- 附件 ID 由前端生成、同时作为服务端文件 ID；同一用户重复上传是幂等覆盖，其他用户占用同一 ID 必须冲突，不能跨用户复用。
- 历史归档格式如果需要变更，先评估 `schema.ts` 的向后兼容，并同步 `history/README.md` 与 `format.ts`。
- 导出的数据绝不能包含 API Key 或应用设置。
- 删除附件是硬删除（元数据 + 磁盘原件）；`DELETE /chats/{id}` 永久删除会话，只清理不再被其他会话引用的附件。清空全部历史会在逐条永久删除会话后调用 `DELETE /files`，把草稿等未引用附件一并清空。
- `latestReminder` 是写入消息的历史快照，续写沿用，不要用当前时间重新计算覆盖历史快照。

### 服务端托管与嵌入 UI

- 浏览器只访问同源 `/api/v1`；不要恢复 `__API_ORIGIN__` 或前端直连 DeepSeek。
- `pnpm build` 构建到 `dist/` 并复制到 `internal/webui/dist/`，Go 用 `//go:embed all:dist` 嵌入。`internal/webui/dist/.gitkeep` 保证未构建时也能编译。
- 修改前端后如果打二进制，必须重新跑 `pnpm build`，否则嵌入的是旧产物。
- `internal/webui/dist/*` 是生成物，已 gitignore；不要提交构建产物。
- CSP 在 `server.securityHeaders`，允许同源脚本/样式、data/blob 图片和 https 图片；新增外链资源前先确认 CSP。
- `file://` 已不支持；开发用 8091 Go + 8090 dev proxy，生产由 Go 服务托管。

## 8. 验证方式

```sh
pnpm type     # tsc 严格类型检查
pnpm lint     # oxlint
pnpm build    # 构建前端并复制到 internal/webui/dist
pnpm dev      # 前端开发服务器 http://localhost:8090
pnpm format   # oxfmt 全仓库格式化
go test ./... # Go 单元/接口测试
go vet ./...  # Go 静态检查
```

开发时先起 Go（8091，`--api-origin` 可指向 mock），再起 `pnpm dev`（8090 代理 `/api`）：

```sh
go run ./cmd/chat-deepseek serve --data-dir ./data-dev --listen 127.0.0.1:8091 --no-browser
pnpm dev
```

前端仍没有自动化测试；Go 已有测试。改动后除门禁外需要手动冒烟（按改动范围挑选）：

1. 未登录显示登录页；登录后加载会话；退出登录回到登录页。
2. 设置里保存 / 更换 API Key、主题、语言、位置、thinking/search；刷新后仍在。
3. 新建对话、发送、流式输出、停止、重新生成、编辑提问、切换版本、继续生成。
4. 上传图片 / 文档、拖放 / 粘贴、发送、刷新后仍能显示和下载。
5. 思考 / 搜索开关、来源面板、链接阅读、引用角标。
6. 移动端布局（<768px）、键盘弹出；历史导入导出、删除全部会话。
7. 生产二进制：`pnpm build` 后 `go build -o chat-deepseek ./cmd/chat-deepseek`，访问 `/` 能看到 UI 和静态资源。
8. 停止服务后 `chat-deepseek backup` 生成 ZIP，`backup list` 能看到，`backup restore --yes` 能覆盖 `config.json`、`chat.db`、`master.key`、`files/`；服务运行、存在 `chat.db-wal` 或 `chat.db-shm` 时拒绝备份和恢复；自定义 `--backup-dir` 正常工作。
9. GUI：用临时 `XDG_CONFIG_HOME` 和数据目录启动，确认左侧四页（服务 / 账户 / 备份 / 设置）可切换，账户和备份的导航徽标未登录为 `—`；账户页、备份页未登录显示锁态和登录入口。Owner 登录后四页正常：账户页可用 `↑`/`↓`/空格/`Enter` 选择，添加/重置密码/授组/撤组/禁用/启用/删除可用；Admin 登录后授组、备份、操作 Owner 置灰，只能管理 User，不能禁用/删除自己。备份页在服务运行时显示“备份需要先停止服务”，停止操作单独二次确认，停止后“立即备份”生成 ZIP、列表出现记录，恢复确认复述会覆盖 `chat.db`、`config.json`、`master.key` 和 `files/`。设置页连接卡“测试连接/应用切换”可用，服务端配置卡逐项保存后 `config.json` 与 `info` 一致，带未应用改动离开会先确认；服务页 `⋯` 有安装/更新/卸载和命令行帮助。关闭 GUI 后会话文件消失；改数据目录、恢复备份后重新登录；确认密码不出现在命令行与输出。
10. `gui/.venv/bin/python -m unittest discover -s gui/tests` 通过。
11. CLI 登录：`setup` 后未登录执行 `user list` 应退出 3；`login` 后 `whoami` / `user list` 正常；同一机器两个终端分别登录不同账户互不影响；`logout` 只退当前终端；过期后退出 3；`Admin` 授组、操作 `Owner`、`backup` 创建/列表/恢复应退出 4。GUI 使用同一套 CLI 登录态，流程见第 9 项。
12. `info`：空目录输出 `initialized=false` 且不创建 `chat.db`/`config.json`/WAL；setup 后 `initialized=true`；配置值、`backup_dir` 默认值和 `--system` 的 `service_*` 字段正确。
13. `config set`：四个 key 正常写入并提示生效时机；未知字段保留；`0600`；非法值退出 2；`backup_dir` 清空回默认；损坏的 `config.json` 不被覆盖。
14. `service`：用临时 `XDG_CONFIG_HOME` 和 fake `systemctl`/`loginctl`（临时 PATH）验证 user/system unit 内容、未初始化拒绝安装、install 不启动、`--enable` / `--disable` 切换 enable、`--force` 覆盖、linger 提示、status 解析和不支持平台行为；不要在本机真的写 `~/.config/systemd/user` 或 `/etc/systemd/system`。
15. GUI 配置迁移与服务：v1/v2 `config.gui.json` 启动后变成 v3（`local` + `ssh` 两段），旧 `backup_dir` 写进 `config.json`；临时 PATH 放 fake `systemctl`/`loginctl`，在服务页 `⋯` 打开“安装服务”，用下拉框切到“系统目录”，确认只出现“安装命令”和“CLI 帮助”两条单行字段、各自有“复制”按钮，安装命令包含 `sudo ... service install --system --run-as <user>`，CLI 帮助命令能列出 start/stop/restart/uninstall；确认不会执行这些系统命令。再切回“用户目录”安装，确认 `--enable`、`start` 调用和 linger enable/disable 命令；再走更新（可调整开机自启，`--force` + `restart`；即使缓存状态过期也会真正重启，失败会弹错误）、停止、重启和卸载，确认“关闭 GUI 不停止 systemd 服务”；不要真的写用户或系统 systemd 目录。
16. GUI SSH：用临时 `XDG_CONFIG_HOME` 和 fake `ssh`（`exec /bin/sh -c "$last"`）+ fake 远端 `chat-deepseek`，把 `connection` 设为 `ssh`、`ssh.host` 设为 fake 别名、`ssh.binary_dir` 指向 fake 目录，启动无头 Qt 确认 `info` 回填远端 data_dir、版本标签带 SSH 主机、`remote_user` 取自 `id -un`；设置页连接卡切到 SSH 后点“应用切换”，确认两套路径行按方式显隐、与下面的服务端配置卡在同一滚动页且不重叠。走 login/whoami/logout，确认密码经 here-doc 送达、登录态跨命令复用、关闭后远端会话文件消失；让 fake ssh 断开或 sleep，确认返回 255、提示重新登录并能在下一条命令重连。在 SSH 模式点“启动服务”再点“停止服务”，确认远端进程退出、端口释放（`ssh -T` 不发 SIGHUP，只杀本地 ssh 会留孤儿进程）；确认备份页隐藏“备份到…”，打开页面只认远端 Public URL。再确认设置里的备份地址来自远端 `config.json`，刚连上、`info` 还没返回时不会显示本机路径；在服务端配置卡保存四项后重读 `info`，切回本机再切回 SSH，仍显示各自主机的值。登录后切换连接方式，确认旧目标 `chat.db` 的 `auth_sessions` 行被 `logout` 清掉（本机和远端各测一次）。真机再对一台 Linux/NAS 跑一次 `info`、`service install`、`service start`、linger 提示和 `open_page`（仅 Public URL）。

GitHub Actions 发布流水线在 `.github/workflows/release-{linux,windows,macos}.yml`，只接受 Actions → Release Linux/Windows/macOS → Run workflow 手动触发；push、tag、PR、schedule 都不会自动运行。每个 workflow 在自己的 runner 上完整执行 Web 构建、Go CLI 编译和 ZIP 生成；Windows/macOS 还执行 PyInstaller GUI 打包。Linux 包根目录是 `chat-deepseek`、`gui/`（GUI 源码副本）、`src/`（完整源码，内含前端 `src/src/`）和三份文档；Windows 包额外包含预编译 GUI 和同样的 `src/`。macOS ZIP 只含一个 DMG，DMG 内只有 `chat-deepseek-gui.app` 和 `/Applications` 链接；CLI、预配置 `config.gui.json` 和三份文档都在 `.app/Contents/Resources`，不附带源码。`src/` 由 `git archive HEAD` 生成，不包含 `data/`、`node_modules/`、`gui/.venv` 或构建产物。Linux runner 用 `ubuntu-latest`，只构建 CLI；Windows 用 `windows-latest`，构建 CLI 和 GUI；macOS 用 `macos-latest`（arm64），构建 `.app`、DMG 和只含 DMG 的 ZIP。Windows GUI 是带 `.ico` 图标的 `.exe`；macOS GUI 是带 `.icns` 图标的 `chat-deepseek-gui.app`。macOS 数据目录默认在 `~/Library/Application Support/chat-deepseek/data`，DMG 中的 `config.gui.json` 作为首次启动模板。在 tag 上运行会把 ZIP 上传到同一个 GitHub Release，在分支上运行只保留 Actions artifacts；三个 workflow 可并行，发布步骤对 Release 创建/上传做重试。上游遗留的 GitHub Pages workflow 已删除。前端新增测试框架前先与用户确认。

## 9. 高风险点（改 store / 数据 / 流式时重点看）

- `store.ts` 是单文件核心，`historyEpoch`、`deletingSessions`、`deletionTasks`、`unsavedSessions`、`pendingFiles`、`streamFlushes`、`titleRequests`、`sessionLoads`、`importingHistory` 互相配合防止竞态；新增动作必须复用这些保护，否则容易出现「删除后又被写回」「导入覆盖新消息」「旧请求覆盖新会话」。
- 流式更新只按动画帧刷新内存，离开页面时 `bindChatPersistence` 会 flush；新增状态字段要确认能随 `persist` / `settleReply` 一起落盘。
- 消息树不变量：`parentId` / `selectedChildId` 必须一致；新分支用 `appendBranch`，切换用 `selectVersion`，不要手改 `messages` 顺序。
- 上下文规则（哪些消息进请求、哪些块回传、能否续写）集中在 `reply.ts`；改动会影响「继续生成」、历史导入与重新生成，需一起验证。
- 安全拒绝（`stop_reason: refusal`）时已下发的思考和正文会被丢弃、只保留模板；拒绝轮次不进入上下文。
- 上传任务按附件本地 id 复用；`serverId` 失效重传和图片长边检查会回写会话并持久化，注意不要在请求快照里用旧 `serverId`。
- `db.ts` 的 `versions` 与 `queues` 是服务端会话落盘的关键：同一会话必须串行 PUT，收到 409 不要静默覆盖；新增保存路径不能绕过 `saveSession`。
- 历史替换会中止所有生成、清空草稿与缓存；导入必须先上传新附件，再由 `POST /import` 单事务替换会话。失败时客户端负责删除新上传文件，旧数据不能动。
- 附件 `id` 与服务端文件 ID 相同；服务端代理把本地 ID 换成 DeepSeek 远端 ID。不要重新引入“前端上传到 DeepSeek 拿 remote id”的旧路径。
- 清空全部历史会调用 `DELETE /files`；单个会话删除走 `DELETE /chats/{id}`，只删不再被引用的附件，不能直接清空用户全部附件。
- i18n key 增删必须同时改 `zh.ts` / `en.ts`；`TranslationKey` 以 `zh.ts` 为准。
- DeepSeek API 地址由服务端 `--api-origin` / `config.json` 控制；前端没有编译期 API 地址。

## 10. 与用户协作改造

- **当前改造目标：按 §13 的 v1 服务端方案实施。** 不再停留在讨论阶段；新增功能优先按 §13 的边界落地。
- `README.md` 只写用户和开发者需要的事实与用法，保持与上游 README 同等的信息密度；试错过程、环境限制、临时决定写到 §12，不要把 README 变成日志或垃圾桶。
- 建议流程：确认目标与验收标准 → 读相关模块与数据流 → 给出影响面 / 方案 → 实现 → `type` / `lint` / `build` → 按 §8 手动冒烟 → 汇总改动、风险与未覆盖项。
- 需要向用户确认的典型问题：
  - 改造是功能扩展、UI 改版还是底层重构？需要兼容上游 `deepseek-ai/chat-demo` 的后续合并吗？
  - 是否需要兼容现有浏览器 IndexedDB 数据迁移到服务端？v1 当前不自动迁移。
  - 是否允许引入新依赖 / 测试框架？
  - 验收方式：手动演示、截图，还是补自动化测试？
- 未明确要求时不要提交 git commit、不要改 `package.json` 版本、不要动 `dist/`。

## 11. Git 工作流

- 远程：
  - `origin` = `git@github.com:elegantgx/chat-deepseek.git`（自己的 GitHub fork，SSH，日常推送目标）
  - `upstream` = `https://github.com/deepseek-ai/chat-demo.git`（上游，只读同步）
- `main` 是上游镜像：只同步、不开发、不在上面提交或合并本地改动；`feature/*` 承载本地改造。
- 本仓库已设置 `remote.pushDefault = origin`，`git push` 默认推到自己的 GitHub fork；`git pull` 仍按各分支自己的跟踪关系。
- 定期同步上游并合并：

  ```sh
  git switch main
  git pull --ff-only          # main 跟踪 upstream/main
  git push origin main        # 让 origin/main 也保持上游内容
  git switch feature/dev
  git merge main
  git push                    # 推 feature/dev 到 origin
  ```

- 冲突只在 `feature/*` 分支解决，不要为了让合并通过而修改 `main`。
- 标签：上游 tag 原样镜像到 `origin`（`v0.1.0`–`v0.1.4` 已推送）；同步上游 tag 用 `git fetch upstream --tags`，再 `git push origin --tags`。
- 版本：`package.json` 的名称是 `chat-deepseek`，版本是 `0.1.4-official0.1.4`；版本号第一位（major）跟随上游，当前上游也是 `0.x`。`package.json` 的 `version` 不带 `v`，但带 `official` 后缀。
- 我们自己的发布 tag 带 `v` 前缀，格式为 `v<我们的版本>-official<上游版本>`，例如 `v1.0.0-official0.3.0`；当前版本对应 `v0.1.4-official0.1.4`，不与上游 `vX.Y.Z` 混用。`package.json` 的版本与 git tag 一一对应，tag 只多一个 `v`。
- `AGENTS.md` 提交在 `feature/dev`，不要提交到 `main`。
- 本机 SSH 注意：系统配置 `/etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf` 权限异常，仓库已设置 `core.sshCommand = ssh -F /dev/null` 绕过；换到 SSH 正常的机器时可删除该配置。
- 查看当前跟踪关系：`git remote -v`、`git branch -vv`。

## 12. 环境与试错记录

> README 只保留用户文档；排查过程、环境限制和临时决定记录在这里。

- **SSH 配置**：本机 `/etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf` 权限异常，直接 `ssh` / `git push` 会报 `Bad owner or permissions`。仓库已设置 `core.sshCommand = ssh -F /dev/null` 绕过；换到 SSH 正常的机器时可以删除该配置。
- **pnpm 12 预检**：本机全局 store 在 workspace 外（`~/.local/share/pnpm/store/v11`），DSH 沙箱下 `pnpm type` / `lint` / `build` 前的自动安装检查会报 `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / 只读文件系统；脚本本身仍会继续执行并通过。依赖未变化时可忽略；真正需要安装依赖时可尝试把 store 指到可写目录（如 `--store-dir /tmp/pnpm-store`），当前环境尚未验证。
- **上游连通性**：检查 GitHub upstream 时 `git ls-remote` 曾超时；本地 `upstream/main` 跟踪关系正常，同步失败先排查网络或代理。2026-11-25 经 `127.0.0.1:7897` 代理同步 `v0.1.4` 成功。
- **上游 v0.1.4 同步**：2026-11-25 把 `main` 同步到 `cdf9617`（v0.1.4）并推送 `origin/main` 与 tag；在 `feature/dev` 合并为 `7e88ec5`。冲突集中在 `package.json`、`SettingsDialog.tsx`、`Settings.module.css`（含手写 `.d.ts`）和 `chat/db.ts`：保留服务端适配层与设置页布局，移植导入进度、附件随会话导入、ZIP 读取优化与旧浏览器兼容；`db.ts` 的内存暂存补上批量 `addStagingSessions` 和带 `sessionIds` 的 MIME 回填。
- **package version**：`0.1.4-official0.1.4` 是合法的 semver 预发布版本（prerelease），npm 已验证可解析，pnpm 构建也能读取；本项目不发布 npm，所以可以采用。注意它排序在 `0.1.4` 之前，不要把它当作正式版 `0.1.4` 的替代。
- **Docker 定位**：2026-11-26 评估后决定暂不把 Docker 作为一等发布形态。项目是 `CGO_ENABLED=0` 静态二进制 + 内嵌 Web UI + 纯 Go SQLite，运行时依赖几乎为零，Docker 的依赖隔离和部署简化收益有限；容器化反而要求把 CLI 管理面塞进 `docker exec`（父进程链登录态、停容器后备份、首次交互式 `setup`），与“CLI/OS 是管理边界”的设计冲突。GUI 暂不做 Docker 集成，GHCR 镜像和 amd64/arm64 构建暂缓。NAS/远程服务器方向是 SSH + 二进制 + 主机 supervisor（systemd、tmux 或 NAS 计划任务）；若以后确有 NAS 需求，可另做薄镜像 + compose 示例，明确需要 CLI 初始化，不影响 GUI 与管理模型。
- **服务托管（systemd）**：2026-11-26 增加 `service`，只支持 Linux systemd。默认用户级 unit（`~/.config/systemd/user/chat-deepseek.service`，`WantedBy=default.target`），`--system` 写 `/etc/systemd/system/chat-deepseek.service`（`User=`/`Group=`、`WantedBy=multi-user.target`），需要 root、`--run-as` 和显式 `--data-dir`，禁止以 root 运行。`install` 只写 unit + `daemon-reload`，不启动；“开机自启”和“立即启动”分开（`--enable` / `--disable` 切换 enable）。没开 linger 时注销会停止用户服务，CLI 只打印 `loginctl enable-linger` 提示，不执行 sudo。Windows/macOS 和没有 systemd 的 Linux 不提供后端，继续前台 `serve` 或平台 supervisor（任务计划程序/NSSM、LaunchAgent、tmux/nohup）。不做 daemon/PID、日志命令、静态 unit 文件。
- **backup_dir 归属**：2026-11-26 把 `backup_dir` 放进 `config.json`，因为 `backup`/`backup list`/`backup restore` 是 CLI 能力，不能只由 GUI 配置。解析优先级 `--backup-dir` > `config.json` > `<data_dir>/backups`；`config set` 用原始 JSON map 更新并保留未知字段。`config.json` 会进备份 ZIP，restore 会把它一起恢复，换机器后需要重新设置。GUI v2 已改为通过 `info` 读取、`config set backup_dir` 写入；v1 `config.gui.json` 里的备份地址在首次启动时迁移进 `config.json`。
- **浏览器存储**：v1 已移除 localStorage/IndexedDB，旧浏览器数据不会自动迁移到服务端；需要保留历史时先在旧版本导出 ZIP，再在新版导入。
- **README 语言**：只保留中文 `README.md`，英文版已删除；README 保持用户文档定位，试错与决策记录放这里。
- **UI 文案与视觉**：标题、`appName` 为 `Deepseek`；字标使用 DM Sans 700（OFL，官方界面字体；官方字标本身是定制字形，不能公开使用）。侧边栏和登录页使用 Simple Icons 的 DeepSeek 鲸鱼标志（CC0-1.0）；设置入口是头像 + 用户名菜单，右侧是 `...`；登录页跟随明暗主题（亮色白底 / 暗色官方风格），首页问候语左侧有鲸鱼；系统设置采用官方左右分栏与行式列表，账户资料保存后就地更新，弹窗不关闭、不整页刷新。第三方来源与商标说明见 `THIRD_PARTY_NOTICES.md`。
- **CLI 登录态**：登录态按 shell 隔离，固定 15 分钟；Linux 在 `$XDG_RUNTIME_DIR/chat-deepseek/sessions/`（tmpfs），macOS 在 `$TMPDIR/chat-deepseek/sessions/`，Windows 在 `%LOCALAPPDATA%\chat-deepseek\run\sessions\`，目录 0700、文件 0600，数据库只存哈希。父进程链在 Linux 读 `/proc`、macOS 用 `sysctl`、Windows 用 Toolhelp + `GetProcessTimes`；三平台已交叉编译，Windows 的父进程链运行时尚未在真机验证。GUI 复用同一套登录态，但启动时不继承父 shell 的会话，关闭 GUI 时自动 `logout`。
- **GUI SSH 远程管理**：SSH 连接只使用系统 `ssh` 和用户自己的 `~/.ssh/config`，不引入 paramiko，不做端口映射和 SFTP。GUI 保持一个常驻 `ssh -T <host> 'exec /bin/sh'`，所有 CLI 命令都是这个 shell 的子进程，CLI 的“登录态按 shell 隔离”正好成立，不需要给 CLI 加会话键。需要 stdin 的命令用 here-doc（shell 会预读 stdin），其余命令加 `< /dev/null`；每条命令末尾用带 token 的哨兵打印 `$?`，远端 stderr 走 SSH extended data。超时或断线时杀掉 ssh、返回 255，GUI 关掉通道并提示重新登录，下一条命令自动重连；127 单独提示找不到二进制。远端二进制目录必填，远端数据目录可留空由 `info` 回填；打开页面只认 Public URL，`备份到…` 隐藏。远端前台 `serve` 先打印 `__CD_SERVE_PID__` 再 `exec`，整段包在 `/bin/sh -c` 里兼容 fish/csh 登录 shell；停止时经常驻通道发 `SIGTERM`，再兜底结束本地 ssh——`ssh -T` 没有 pty，只杀本地 ssh 会在远端留下继续占端口的孤儿进程。远端用户级 systemd 服务需要 linger，否则通道断开后会被 logind 停掉。`config.gui.json` 是 v3，`local` 和 `ssh` 各存一份路径；任何 `Target.key` 变化（连接、主机、数据目录）都先停旧前台、对旧目标 `logout`、关旧通道，再切新目标并重读 `info`。本机 logout 用子进程跑旧二进制，远端必须走原来那条常驻通道（登录态绑在那个 shell 上，另开 ssh 找不到会话文件），通道已断时清不掉，只能等 15 分钟过期；失败保留旧目标，不半切换。服务端四项和路径只认当前目标：另一台的 `config.json` 不缓存、不展示只读副本，切换后重新读；远端 `info` 返回前留空，不用本机默认值兜底。
- **GUI 管理界面**：`gui/app.py` 是 46 行薄入口，`gui/cdgui/` 分层为 `domain/`（纯逻辑）、`infra/`（子进程 / SSH / runner / gateway / serve / 持久化）、`store.py`、`controller.py`、`ui/`（窗口、投影、四页、控件、表单、对话框、设计尺度）、`bootstrap.py`（装配）；命令参数集中在 `domain/commands.py`，按钮可见/可用/文案集中在 `domain/rules.py`，页面不自己判断权限或服务状态。四页是服务 / 账户 / 备份 / 设置：服务页 1 个主操作 + 重启/打开页面 + `⋯`（安装/更新/卸载/命令行帮助），设置从弹窗改成页面，连接卡与服务端配置卡各自保存，备份独立成页并在服务运行时先要求停机，账户页支持键盘 ↑/↓/空格/Enter。GUI 仍只拼 `chat-deepseek` 子命令，`info` 读服务端配置和 systemd 状态，`config set` 写配置，`parsing.py` 解析中文输出；失败仍把“服务运行中”“端口占用”“最后一个 Owner”“账户不存在”“密码不合规”等已知条件翻译成可操作提示。`config.gui.json` 是 v3（`connection`、`local`/`ssh`、用户名），v1/v2 自动迁移，旧 `backup_dir` 写进 `config.json`；密码只走 stdin，不保存。GUI 登录态复用 CLI，关闭 GUI 自动 `logout`，Admin/Owner 权限与 CLI 一致。`gui/.venv` 不提交，依赖从清华源安装。测试共 627 个，覆盖 domain、infra、controller、store、窗口、四页、对话框、bootstrap、配置迁移、解析器和架构守卫。
- **GUI 视觉**：窗口标题栏、边框和圆角全部使用系统原生（Windows x/□/-、GNOME 关闭按钮、macOS 交通灯），对话框也用原生标题栏；不再 frameless、透明窗口或自绘外壳。尺寸、间距、字号、圆角统一走 `cdgui/ui/tokens.py`，颜色只经 `palette.py`，页面不写魔法数字。账户列表是 60px 两行成员行：头像、用户名、Owner/Admin/User 组标签、右侧状态点；悬停/选中为长胶囊，选中头像变实心蓝，底栏显示已选择/取消选择和操作。卡片 32px 圆角，按钮、输入框、开关用胶囊端，阴影自绘并关闭子像素抗锯齿。安装/更新服务沿用对话框：`FormGrid` 的 112px 标签列、40px 下拉框、`CopyRow` 复制安装命令与 CLI 帮助；系统目录只复制、不执行，不展示不可修改的 unit/路径。界面优先 Microsoft YaHei UI / PingFang SC / Noto Sans CJK SC，字号整体大一档；跟随系统深浅色，GNOME 下直接读 `gsettings` 并用 `dconf watch` 跟随。Windows 子进程用 `CREATE_NO_WINDOW` 避免控制台闪窗，停止前台会话是强制结束。
- **发布流水线**：三个 `.github/workflows/release-{linux,windows,macos}.yml` 各自在原生 runner 上执行 Web 构建、Go CLI 编译和 ZIP 生成，不跨平台传 artifacts；Windows/macOS 还有 PyInstaller GUI。统一用 pnpm 12.6、Node 24；Windows/macOS 用 Python 3.13、PyInstaller 6.22.3。Linux 只构建 CLI，不再打包 GUI：PyInstaller onefile 会绑定构建机 glibc，无法同时覆盖 Ubuntu/Fedora；Linux 包根目录的 `gui/` 是 `src/gui/` 的源码副本，用户按 `gui/README.md` 在本地构建 GUI。`src/` 用 `git archive HEAD` 生成完整项目源码，避免把 `data/`、`node_modules/`、`gui/.venv` 和构建产物打进去；Windows 用 `git archive --format=zip` 再 `Expand-Archive`，Linux 用 `git archive HEAD | tar -x`；macOS 不再附带源码，只生成 DMG。Windows 用 PowerShell，macOS 用 `macos-latest` arm64。Windows 不直接跑 `pnpm build`（脚本含 `rm -rf` 和 Unix 环境变量），三个 workflow 都改为 `pnpm exec rspack build` + `node scripts/embed-ui.mjs`，由 `NODE_ENV=production` 控制模式。Windows 用 `--icon whale.ico`；macOS 在 onefile 产物外组装 `chat-deepseek-gui.app`（Info.plist + `whale.icns` + `Contents/Resources/config.gui.json` + ad-hoc codesign），用 `hdiutil` 打成 DMG，DMG 内只放 `.app` 和 `/Applications` 链接，CLI、`config.gui.json`、文档都放进 `.app/Contents/Resources`，最后 ZIP 只装 DMG。DMG 里的 `config.gui.json` 使用 v2 结构，预配置 `local.data_dir` 到 `~/Library/Application Support/chat-deepseek/`；`backup_dir` 不再写 `config.gui.json`，由首次运行后的 `info` / `config set` 管理。`.app` Resources 里也放一份作为首次启动模板。三个 workflow 不再共用 concurrency，发布步骤对同一 tag 的 Release 创建/上传做重试。Windows 包未签名；macOS `.app` 只做 ad-hoc 签名，没有开发者签名/公证。
- **嵌入 UI**：Go 二进制只包含编译时 `internal/webui/dist/` 里的内容；仓库只提交 `.gitkeep`。忘记 `pnpm build` 会得到占位页，不是运行时找不到文件。
- **分支历史**：`feature/dev` 已推送到 GitHub；不要重写已推送的提交，需要修历史时先在 GitHub 处理分支保护设置或换新分支。
- **Go 缓存**：本机默认 `GOPATH`/模块缓存位于 workspace 外，DSH 沙箱下只读。构建/测试需把 `GOPATH`、`GOMODCACHE`、`GOCACHE` 指到 workspace 的 `tmp/`（已 gitignore）；例如 `export GOPATH=$PWD/tmp/gopath GOMODCACHE=$PWD/tmp/gopath/pkg/mod GOCACHE=$PWD/tmp/go-build`。`/tmp` 在部分工具调用间不保留，不要依赖它。

## 13. v1 服务端改造（进行中）

> 2026-11-23 起实施。以下是已确认的设计决策；实现进度同步更新本节。

### 目标

- 自托管（Jellyfin 式）：服务端保存账户、会话、附件、设置和 API Key；浏览器只做客户端。
- 便携：二进制与 `data/` 同级；普通用户运行，不要求 root、不写 `/var`；systemd 只是 Linux 上可选的常驻方式，不依赖它也能前台运行。
- 账户/组管理全部走 CLI；Web 登录后可改自己的用户名、密码和头像，并在数据管理中设置自己的 API Key。
- 保留现有 React 聊天逻辑（`store.ts`、`reply.ts`、`branches.ts`、`view.ts` 和组件），服务端暂做存储 + DeepSeek SSE 代理，减少与上游同步的冲突。
- v1 只做 Web；不做 PWA、Android 原生；Docker 交付暂缓。

### 便携目录

```text
chat-deepseek/
  chat-deepseek          # 二进制
  data/
    config.json          # 监听地址、Public URL、API 地址、备份地址
    chat.db              # SQLite
    master.key           # API Key 加密主密钥（0600）
    files/<user_id>/     # 附件原件
    backups/             # 备份 ZIP 输出目录
```

- 默认数据目录是二进制所在目录下的 `data/`；`--data-dir` 仅用于测试或特殊安装。
- 监听高位端口（默认 `8090`），不申请特权；前台运行，SIGINT/SIGTERM 优雅关闭。
- CLI 可选生成 systemd unit（仅 Linux，见 `service`）；其他平台和场景用 tmux、nohup、任务计划程序、LaunchAgent 或自己的 supervisor 托管。
- 数据目录 0700、数据库和密钥 0600；不把敏感数据写到用户主目录之外。

### 账户与组

- 组名单数：`Owner`、`Admin`、`User`。
- 所有账户默认属于 `User`；`Admin`、`Owner` 是附加组；可同时属于多个组，能力取并集。
- 最后一名 `Owner` 不能被移除、禁用或删除。
- `Admin` 可创建/禁用/重置/删除普通 `User`；不能操作 `Admin`/`Owner`，不能授予/撤销组。
- `Owner` 拥有全部能力：授组、服务器设置、备份/恢复、清理实例。
- 不提供跨用户聊天浏览；Owner 的物理访问来自服务器目录和备份。
- Web 没有用户/组管理页；CLI 是唯一管理入口，CLI 是 OS 信任边界。
- 无公开注册、无邮件/TOTP；忘记密码由 CLI 重置。

### 数据与设置

- SQLite 是唯一数据源：账户、组关系、登录会话、聊天会话 JSON、文件元数据、每用户设置。
- 附件按用户隔离：`data/files/<user_id>/`。
- 所有用户设置（主题、语言、位置、朗读音色、thinking/search、侧栏等）存服务端；**前端不使用 localStorage/IndexedDB**，只保留 HttpOnly 会话 cookie 和内存中的 CSRF token。
- API Key 用 AES-GCM 加密，`master.key` 单独保管；不返回前端、不写日志。
- 删除会话即永久删除；备份用 CLI 把数据目录打包成 ZIP，不引入恢复服务端事务。

### API 与前端边界

- 统一 `/api/v1`；同源 Cookie 会话 + CSRF；登录限流。
- 主要接口：`auth/login|logout|me|password|username|avatar`、`settings`、`chats`（带 `version`）、`import`、`files`、`stream`（DeepSeek SSE 代理）、`speech/asr|tts`、`healthz`。
- 历史导入导出仍由前端 ZIP 逻辑完成；解析后的会话通过 `POST /import` 在服务端单事务替换，附件使用新 ID 预上传。
- 聊天分支与上下文构建暂留在 Web TS；服务端保存 `Session` JSON 并代理 SSE。二期原生 App 前再把上下文构建下沉 Go 或复用现有逻辑。
- 多端并发：只用会话 `version` 乐观锁（409），不引入生成租约；极端同时发送时后写方收到冲突后重试。
- 前端改造尽量保持 `db.ts`、`settings.ts`、`attachments.ts` 的函数签名，新增 `/api/v1` 客户端；不改 `reply.ts`、`branches.ts`、`view.ts` 和聊天组件，方便上游合并。

### 非目标（v1）

- 公开注册、TOTP、邮件找回、Web 管理页。
- 自定义组、细粒度权限。
- 离线、双向同步、CRDT。
- PWA、Android 原生、多实例/集群、E2E 加密。

### 实施顺序

1. Go module、配置、`data/` 解析、CLI 骨架。
2. SQLite 迁移与账户/组模型。
3. Argon2id、session、CSRF、登录 API、CLI `setup/user`。
4. 设置、API Key 加密、聊天存储、文件与 DeepSeek SSE 代理。
5. 前端登录与存储适配，移除 localStorage/IndexedDB。
6. 备份 CLI、旧 ZIP 数据迁移、测试与文档。

### 上游同步

- `main` 仍只镜像上游；feature 分支承接改造。
- 尽量不改聊天核心逻辑；服务端和适配逻辑放新文件/新目录。
- 上游对 `db.ts`、`settings.ts`、`client.ts`、`store.ts` 的改动可能与改造冲突，合并时优先保留上游行为，再补适配层。
- `package.json`、README、AGENTS 的分叉是预期内的。

### 当前进度

已完成：

- Go module 与依赖；`cmd/chat-deepseek` CLI。
- 便携 `data/` 解析、`config.json`、SQLite WAL 与 schema v5（`files.purpose`、`users.avatar`、`auth_sessions.scope`；移除 `deleted_at`、`generation_leases`）。
- 固定组 `Owner/Admin/User`、账户 CRUD、最后活动 Owner 保护。
- Argon2id、登录会话、CSRF、登录限流、`auth/login|logout|me|password|username|avatar`。
- CLI `setup`、`serve`、`backup`、`user add/list/groups/grant/revoke/disable/enable/reset-password/delete`。
- CLI `login` / `logout` / `whoami`：按 shell 隔离、固定 15 分钟；`user ...` 与 `backup ...` 按组校验，退出码 3/4；浏览器与 CLI 会话按 scope 隔离。
- CLI `info` / `config set` / `service`：`info` 只读输出固定 `key=value`；`config set` 保留未知字段并原子写 0600；`service` 生成 systemd user/system unit（install/uninstall/start/stop/restart/status），备份命令统一从 `config.json` 读取 `backup_dir`；退出码补齐用法错误 2。
- GUI 登录态：未登录锁定账户/备份区，按 Admin/Owner 置灰操作，关闭自动 logout；记住上次用户名；修复暗色系统首次启动被判成亮色。
- GUI v2：`config.gui.json` 改为 `version`/`connection`/`local` 并自动迁移 v1；服务端配置和 systemd 状态改用 `info`，设置改用 `config set`；Linux + systemd 增加用户级服务管理：安装对话框用下拉框选择用户目录/系统目录，用户目录直接安装，系统目录只生成带 `sudo` 的安装命令和 `service --help` 帮助命令供复制（GUI 不提权），支持安装（可选开机自启/安装后启动）、更新（可调整开机自启）、启动、停止、重启、卸载与 linger 提示，未安装时保留前台会话模式。
- GUI v3 与 SSH 远程管理：`config.gui.json` 增加 `ssh{host,binary_dir,data_dir,username}`（v1/v2 自动迁移）；设置里可选本机/SSH，主机吃 `~/.ssh/config`，远端二进制目录必填、数据目录可留空由 `info` 回填；常驻 `ssh -T <host> 'exec /bin/sh'` 通道执行全部命令，登录态复用、密码 here-doc、哨兵退出码、stderr 分离、255 断线重连和 fake ssh 测试已完成；远端 `serve`、备份、路径、systemd/linger、Public URL 行为已按远端分支，`备份到…` 禁用。GUI 测试 627 个通过；无头 Qt 已核对本机/远端启动、`info` 回填、remote_user、login/whoami/logout，以及远端 serve 启停后进程退出与端口释放、备份地址只取当前主机 `config.json`。
- `master.key` 与 AES-256-GCM；每用户偏好/API Key API，Key 不出服务端、不写日志。
- 会话 CRUD、`version` 乐观锁、永久删除，按用户隔离；历史导入经 `POST /import` 原子替换。
- 附件上传/下载/永久删除/批量清理，按用户目录保存；chat 请求里的本地 `file_id` 会惰性上传到 DeepSeek 并缓存远端 ID。
- `backup` CLI 把数据目录打包成 ZIP，支持 `--backup-dir`（默认读 `config.json` 的 `backup_dir`，否则 `data/backups`）、`backup list` 和 `backup restore`；检测到 `chat.db-wal`/`chat.db-shm` 时拒绝，避免运行中备份或恢复。
- GitHub Actions 三平台手动发布流水线（Linux / Windows / macOS 各自独立 workflow，tag 运行时上传 GitHub Release）。
- DeepSeek SSE 代理、ASR/TTS 代理、API Key 校验；上游错误状态原样透传。
- 前端认证门/登录页、服务端设置与 API Key、会话/附件适配，localStorage/IndexedDB 已移除。
- Web UI 嵌入 Go 二进制；生产静态资源与登录页已在无头 Chrome 中验证。
- Go 单元/接口测试覆盖 secret、settings、chat、filestore、backup、deepseek、server、service、cli；GUI 解析/配置/SSH 通道/命令拼装/四页布局测试 627 个通过，并已用无头 Qt + fake systemd 走过 v1→v2 迁移、设置保存、用户级服务安装/更新/启停/卸载和系统级命令复制。

未完成：

- 前端自动化测试（可选，需先确认测试框架）。
