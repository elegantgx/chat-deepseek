# 架构与数据契约

> 从 AGENTS.md 拆出来的长期细节：数据模型、API、CLI 契约、核心流程、v1 服务端设计与高风险点。
> 日常改代码按需读对应小节；不要把它们再搬回 AGENTS.md。

## 1. 分层

- **Web 前端**（`src/`，React 18 + TS strict + zustand + rspack）只做交互与渲染，所有数据经同源 `/api/v1`。
- **Go 服务端**（`internal/`）保存账户、会话、附件、设置、API Key，并代理 DeepSeek 的 SSE / ASR / TTS。
- **CLI**（`cmd/chat-deepseek` + `internal/cli`）是唯一管理入口：`setup`、`serve`、`backup`、`user ...`、`login`、`info`、`config set`、`service`。
- **桌面端**（`desktop/`，Electron）是本地图形外壳：主进程管窗口、单实例与请求转发，渲染层经本机 `ipc` 控制服务，浏览器仍只走 `/api/v1`。
- 依赖方向：页面/组件 → services → `api/client`；Go 侧 cmd 装配依赖，`internal/*` 不写全局状态。

## 2. 数据模型

### 2.1 会话

- `Session`：`id`、`title`、`createdAt`、`updatedAt`、`messages`、`rootMessageId?`。
- 消息树：消息可带 `parentId` / `selectedChildId`；`rootMessageId === undefined` 表示旧版线性列表，`null` 表示空会话。展示与上下文都由 `getVisibleMessages()` 沿 `selectedChildId` 走出当前分支。
- `UserMessage`：`content` + `files: FileAttachment[]`。
- `AssistantMessage`：`model`、`thinking`/`search` 开关、`latestReminder`、`prefix`、`status(pending|streaming|done|stopped|error)`、`blocks`（thinking/text/server_tool_use/web_search_tool_result/web_fetch_tool_result）、`stopReason`、`stopDetails`、`usage`、`error`。
- 附件：`id` 同时是服务端文件 ID；`serverId` 也是服务端文件 ID，代理时再换成 DeepSeek `file_id`；`isImage` 决定上传 purpose 与请求块类型；`imageSizeChecked` 表示当前副本已确认长边合规。

### 2.2 持久化

- SQLite 是唯一数据源：`groups`、`users`、`user_groups`、`auth_sessions`、`chats`、`files`、`user_settings`。
- `auth_sessions.scope` 区分 `web` / `cli`；浏览器 Cookie 与 CLI token 不能互相冒用。CLI 登录态本体在用户运行时目录，数据库只存 token 的 SHA-256。
- 会话以完整 `Session` JSON 存进 `chats.data`；`version` 由服务端递增，客户端在 `db.ts` 内存 map 维护版本，同一会话的保存串行执行。
- 列表只返回摘要，详情按需加载；内存缓存上限 `SESSION_CACHE_LIMIT = 5`，淘汰时避开当前会话、生成中、未保存、删除中的会话。
- 附件原件在 `data/files/<user_id>/<file_id>`，元数据在 `files` 表；上传以附件 ID 作幂等键，同用户重复上传覆盖，跨用户冲突；删除附件同时删元数据与原件，最后一个附件删除后移除空用户目录，启动时也清理遗留空目录。
- 草稿只在内存（`drafts.ts`，`string | null` 区分会话/新对话），刷新即丢。
- 保存失败会中断落盘并在顶部显示重试条；`version` 409 表示被其他窗口更新，提示刷新，不静默覆盖。

### 2.3 历史归档

- 格式 `export_format_version: 3`；ZIP 内容：`manifest.json`（首条）、`chat_sessions/{id}.json`、`chat_session_index.json`、`chat_sessions/{id}_files/...`（仅图片原件）。
- 导入先校验版本，按会话分批读 ZIP（会话 JSON 与对应图片一起）写入浏览器内存暂存，进度按已处理会话数回调；确认后给附件换新 ID 并上传，再由服务端 `POST /import` 单事务替换全部会话。失败只清理新上传文件，旧数据不动。
- 导出只含当前分支与能下载的图片原件；不含 API Key / 设置 / 非图片附件。
- 导入/导出/全部删除由 `backup.ts` 串行队列执行；全部删除永久删会话并清空附件目录。
- 细节见 `src/services/chat/history/README.md`；改格式必须同步 `format.ts` / `schema.ts` 与该文档。

## 3. API 与协议

- 浏览器只访问同源 `/api/v1`；DeepSeek 请求全部由 Go 代理，前端没有 API Key，也没有 `__API_ORIGIN__` 构建常量。
- 认证：`POST /auth/login` 设 HttpOnly Cookie（scope `web`）；CLI 复用 `auth_sessions` 但 scope `cli`，token 不能互换；`GET /auth/me` 返回 `user`（含 `avatar`）、`csrf`、`expiresAt`、`hasApiKey`；另有 `POST /auth/logout`、`POST /auth/password`、`PUT /auth/username`、`PUT /auth/avatar`。登录校验同源；登录后的非 GET 需 `X-CSRF-Token`；登录限流按 IP + 用户名。
- 设置：`GET/PUT /settings` 读写偏好；`PUT /settings/api-key` 保存加密 Key，`DELETE` 清除，`POST /settings/api-key/verify` 用候选 Key 调 `/models` 校验。任何响应都不返回 Key 明文或密文。
- 会话：`GET/POST /chats`、`GET/PUT/DELETE /chats/{id}`。PUT body `{session, version}`，版本不匹配 409；DELETE 永久删除并清理不再被引用的附件。
- 导入：`POST /import` body `{sessions: [...]}`，单事务替换当前用户全部会话；附件须提前用新 ID 上传，成功后清理旧附件。
- 文件：`POST /files`（multipart：`id`、`purpose`、`isImage`、`file`）、`GET/DELETE /files/{id}`、`DELETE /files` 清空当前用户附件。
- 流式：`POST /stream` 接收 Anthropic Messages 请求体；服务端注入 Key、强制 `stream: true`、把本地附件 ID 惰性上传并替换为 DeepSeek `file_id`，再原样转发 SSE。上游非 2xx 的状态与响应体透传。
- 语音：`POST /speech/asr` 转发 multipart；`POST /speech/tts` 转发 JSON 并返回裸 PCM（24 kHz、单声道、16-bit 小端）。
- 上游协议：Anthropic 兼容 Messages，含 `model`、`system`、`messages`、`thinking`、`tools`、`safety_check: {level: 'high'}`，无标题时加 `title`；模型固定 `deepseek-flash`。SSE 解析在 `api/sse.ts`、`api/parseEvent.ts`、`chat/reply.ts`。
- 错误统一 `ApiError`（`http|stream|network|interrupted|protocol`），分类不直接生成文案，各场景自己选 i18n key；会话 401 触发整页回登录，DeepSeek 透传的 401 不触发。

## 4. CLI 契约（冻结）

- 文本输出就是契约，不加 `--json`：`user list` 表头、`whoami` 的 `username\tgroups\texpires`、`backup list` 的 `NAME\tSIZE\tTIME`、`backup` 的 `备份已写入 <path>`、`serve` 启动前缀、`version` 格式都不可随意改。
- `info` 输出固定顺序 `key=value`：`version/os/arch/binary/data_dir/initialized/listen/public_url/api_origin/backup_dir/service_*`；`service status` 输出其中 `service_*` 七项。`info` 只读，不创建数据库、`config.json` 或 WAL。
- 退出码：`0` 成功、`1` 运行错误、`2` 用法错误、`3` 未登录/过期、`4` 权限不足。
- `info` / `config set` / `service` 不需要应用登录；`service` 仅 Linux systemd，默认 user unit，`--system` 需 root、`--run-as` 和显式 `--data-dir`；`service --help` 列出全部子命令。
- 文本格式变更必须同步 README 与所有解析这些输出的调用方。

## 5. 核心流程

### 5.1 启动

1. `main.tsx`：`ensureKatex()`、`setupTheme()`、渲染 `<Root/>`。
2. `Root` 调 `getMe()`：未登录显示登录页；已登录先 `loadSettings()` 再挂载 `<App/>`。登录/退出都整页重载，清空上一账户内存状态。
3. `App` 调 `initChat()` 读会话摘要；没有 API Key 时 `ensureApiKey()` 打开设置的数据管理分组。
4. `selectSession()` 只设 `activeId` 并触发懒加载；`historyEpoch` 防止旧请求覆盖新状态。
5. 打开会话时把上次未结束的 `pending/streaming` 结算为 `stopped` 并写回。

### 5.2 发送

1. 输入与附件进内存草稿；附件立即校验（扩展名 → 大小 → 数量）并上传（最多 3 并发，按本地 id 复用）。
2. `sendMessage()`：要求附件上传完成；无会话则新建；`appendBranch` 挂「用户消息 + 空助手消息」；先 `persist`，再清草稿，最后异步 `streamReply`。
3. `streamReply`：注册 `AbortController`；`requestAnimationFrame` 合并流式更新；`prepareFiles` 补齐 `serverId`（本轮失败整体重试，历史失败跳过，旧图超长边则重传）；生成 `latestReminder`；`toRequestMessages` 组装上下文；消费 SSE；`message_delta` 带标题且会话仍无标题时自动命名；结束/失败/停止都经 `settleReply` 收尾落盘。
4. DeepSeek 判定 `file_id` 失效时清 `serverId` 重传后重发，最多 2 次退避；已收到内容块后不自动重发。

### 5.3 分支与续写

- `regenerateReply`、`editMessage` 都在同一父节点下新增兄弟版本，不覆盖旧回答；`appendBranch` 更新 `selectedChildId`。
- `selectMessageVersion` 只允许切换当前分支路径上的兄弟版本；生成中禁止切换。
- `continueReply` 复用原助手消息并追加 `blocks`；仅当 `canContinueReply` 为真（`prefix`、非拒绝、非 `tool_use`、无服务端工具块、无模板、`stopped` 或 `done + max_tokens`）。
- 上下文只取「用户消息 + 可用助手回复」成对轮次；可用 = `done`/`stopped`、非拒绝、非模板、正文非空。历史思考与引用不回传，历史工具块只回传 `read_link`（要求有签名）。

### 5.4 界面派生

- `buildReplyView()` 把 `blocks` 换算成工具步骤时间线、正文 markdown（插入 `[citation:N]`）、来源列表与搜索结果汇总。
- `useReplyView` 只在来源变化时更新数组，避免正文流式导致 Markdown 反复解析。
- Markdown 链路：节流 → `toMdAst` → `MarkdownAstRenderer`；代码高亮、KaTeX、Mermaid 按需加载。
- 语音：录音 → ASR 返回全文插入光标；朗读把正文转 TTS PCM，按序排程播放，同一时间只读一条，切会话/发送/停止生成时中断。

### 5.5 历史替换

`replaceHistory(write)`：置 `importingHistory` 锁 → 中止所有生成 → 等删除任务与流收尾 → 递增 `historyEpoch` → 清暂存 → 写入 → `commitStaging` 换新附件 ID、上传并 `POST /import` 单事务替换 → 重置缓存与草稿。失败清理新上传文件，旧会话保持可用。

## 6. v1 服务端设计（已实施）

- 定位：自托管（Jellyfin 式）；服务端保存账户、会话、附件、设置与 Key，浏览器只做客户端。
- 便携：二进制与 `data/` 同级，普通用户运行，不要求 root、不写 `/var`，不依赖 systemd。
- 目录：`chat-deepseek` + `data/{config.json, chat.db, master.key, files/<user_id>/, backups/}`；数据目录 0700，数据库与密钥 0600。
- 组：`Owner` / `Admin` / `User`，默认 `User`，附加组取并集；最后一名 Owner 不能被移除/禁用/删除；Admin 只能管理 User，不能授组；Owner 拥有全部能力；Web 无用户管理页，CLI 是唯一入口；无公开注册、无邮件/TOTP。
- 设置与 Key：所有用户设置存服务端；API Key 用 AES-256-GCM 加密，`master.key` 单独保管，不返回前端、不写日志。
- 非目标：公开注册、TOTP、邮件找回、Web 管理页、自定义组、离线/双向同步/CRDT、PWA、Android 原生、多实例/集群、E2E 加密。
- 实施顺序（已完成）：module/CLI → SQLite/账户 → 认证 → 设置/加密/聊天/文件/SSE → 前端适配 → 备份/迁移/测试/文档。
- 未完成：前端自动化测试（是否需要框架先与用户确认）。

## 7. 高风险点

- `store.ts` 单文件核心：`historyEpoch`、`deletingSessions`、`deletionTasks`、`unsavedSessions`、`pendingFiles`、`streamFlushes`、`titleRequests`、`sessionLoads`、`importingHistory` 互相配合防竞态；新增动作必须复用这些保护。
- 流式只按动画帧刷内存，离开页面时 `bindChatPersistence` 会 flush；新字段要能随 `persist` / `settleReply` 落盘。
- 消息树不变量：`parentId` / `selectedChildId` 一致；新分支用 `appendBranch`，切换用 `selectVersion`，不要手改 `messages`。
- 上下文规则集中在 `reply.ts`；改动会影响继续生成、历史导入与重新生成，需一起验证。
- 安全拒绝（`stop_reason: refusal`）时已下发的思考与正文丢弃、只留模板；拒绝轮次不进上下文。
- 上传任务按附件本地 id 复用；`serverId` 失效重传与图片长边检查会回写会话，请求快照不要用旧 `serverId`。
- `db.ts` 的 `versions` / `queues`：同一会话串行 PUT，409 不静默覆盖，新保存路径不能绕过 `saveSession`。
- 历史替换会中止生成、清草稿与缓存；导入先上传新附件再单事务替换，失败时客户端清理新文件，旧数据不能动。
- 附件 `id` = 服务端文件 ID；服务端代理换成 DeepSeek 远端 ID，不要恢复「前端直传 DeepSeek」的旧路径。
- 清空全部历史调 `DELETE /files`；单个会话删除走 `DELETE /chats/{id}`，只删不再被引用的附件。
- i18n key 增删必须同时改 `zh.ts` / `en.ts`，`TranslationKey` 以 `zh.ts` 为准。
- DeepSeek API 地址由服务端 `--api-origin` / `config.json` 控制；前端没有编译期 API 地址。

## 8. 上游同步

- `main` 只镜像上游；feature 分支承接改造；冲突只在 feature 分支解决。
- 尽量不改聊天核心（`reply.ts`、`branches.ts`、`view.ts`、组件）；服务端与适配层放新文件/新目录。
- 上游对 `db.ts`、`settings.ts`、`client.ts`、`store.ts` 的改动可能与改造冲突：优先保留上游行为，再补适配层。
- `package.json`、README、AGENTS 的分叉是预期内的。

## 9. 前端与 Go 代码约定

### TypeScript / 代码风格

- 模块导入带扩展名并写成 `.js`（`moduleResolution: NodeNext`），`.tsx` 也写 `.js`；类型导入用 `import type`。
- 相对路径导入，不引入未使用的路径别名；`strict`、`noUnusedLocals`、`noUnusedParameters`、`noImplicitReturns` 全开。
- oxlint 关键规则：禁止 default export（`rspack.config.ts` 唯一例外）、禁止 `console`（已有内联豁免除外）、禁止 import 循环、禁止 `any`、禁止非空断言。
- 格式由 oxfmt 决定，提交前跑 `pnpm format`（会改全仓库，只提交自己的文件）。

### React / 状态

- 全部函数组件；流式链路上的列表项与消息组件用 `memo`，且 `memo` 必须具名函数表达式。
- 全局状态用 zustand：`services/settings.ts`、`services/chat/store.ts`、`drafts.ts`、`attachments.ts`；组件用 selector 订阅最小状态。
- 局部 UI 状态留在组件内；跨组件的短暂 UI 状态放 `xxxState.ts`（如 `settingsDialogState.ts`、`searchPanelState.ts`、`mobileSiderState.ts`）。
- 不要绕过 store 直接改 `sessionCache`/`sessions`；所有写操作走 `store.ts`，保证持久化、摘要同步与并发保护。

### 样式

- CSS Modules：默认导出，class 用 camelCase；rspack 配置 `namedExports: false`，`localIdentName: '[local]-[hash:6]'`。
- 设计令牌是 CSS 变量：`--dsw-*`（颜色/字体）与 `--ds-*`（控件尺寸/动效）；主题通过 `body[data-ds-dark-theme]` 与 `body.dark` 切换。
- 移动端断点固定 `< 768px`（`app/viewport.ts`）；输入框、顶栏、视口高度依赖 `--app-viewport-*`，改布局不要破坏键盘弹出行为。
- 全局样式在 `app/global.css` / `app/theme.css`，组件样式就近放 `*.module.css`。
- `Button.module.css.d.ts`、`Select.module.css.d.ts`、`Settings.module.css.d.ts`、`Sider.module.css.d.ts` 是手写类型声明，会覆盖 `env.d.ts`；给这四个模块新增 class 必须同步补 `.d.ts`，否则 `pnpm type` 报错。

### 可访问性与安全

- 图标按钮提供 `aria-label`；状态变化用 `role="status"` / `aria-live`；弹窗、菜单、选择器保留键盘与焦点管理。
- 外链统一 `target="_blank" rel="noreferrer"`；Markdown 走 AST 渲染，不允许裸 HTML 注入（不要改回 `dangerouslySetInnerHTML`）。

### Go

- 服务端包不写全局状态，CLI 负责装配依赖；新增 Go 代码尽量放 `internal/`，与上游 TS 分开，方便合并。
- 数据库 schema 当前 v5（`files.purpose`、`users.avatar`、`auth_sessions.scope`；移除 `deleted_at`、`generation_leases`）；迁移写在 `internal/database`。
- 数据目录 0700，数据库与 `master.key` 0600。
