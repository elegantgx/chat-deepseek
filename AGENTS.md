# AGENTS.md

> 本文件每次会话都会注入，只放「每个 agent 必须先知道的事」。
> 具体细节按需读 `docs/`，不要往这里堆实现细节、验收记录和试错过程。

## 1. 项目

- `chat-deepseek`：**Go 自托管服务端 + React Web 客户端**，服务端保存账户、会话、附件、设置和 API Key；浏览器不再保存聊天或 Key，也不用 localStorage/IndexedDB。
- 能力：账户登录、多会话与消息分支、流式回复、深度思考、联网搜索、附件、Markdown/代码高亮/KaTeX/Mermaid、中英双语、明暗主题、移动端、语音、历史导入导出。
- 技术栈：React 18.3、TypeScript 7（strict）、rspack 2、zustand、fflate、katex、prismjs、mermaid；Go 1.27+、SQLite（`modernc.org/sqlite`）、Argon2id、AES-GCM。
- 运行：Node 22.12+、pnpm、Go 1.27+；前端 dev 8090，Go dev 8091。GNU/Linux 为主要目标，Windows/macOS 也发布。
- 版本 `0.1.5-official0.1.4`，MIT。
- 部署：便携二进制（`go:embed` 内嵌 Web UI）+ 同级 `data/`，普通用户运行；只通过 HTTP 访问，`file://` 不再支持。
- GUI：`gui/` 是 PySide6 管理外壳，只拼 `chat-deepseek` 子命令，不碰数据库。

## 2. Git

- 远程：`origin` 是日常推送的 fork，`upstream` 是只读的上游 `deepseek-ai/chat-demo`；具体地址以本地 git 配置为准，**不要写进仓库文档**。
- `main` 只镜像上游，不开发、不在上面提交；日常在 `feature/*`；冲突只在 feature 分支解决。
- 同步上游：`git switch main && git pull --ff-only && git push origin main`，再回 feature 分支 `git merge main`。
- 上游 tag 原样镜像；自己的发布 tag 带 `v`：`v<版本>-official<上游版本>`。
- 若本机 `ssh` / `git push` 因系统 ssh 配置权限报错，可临时用 `git config core.sshCommand "ssh -F /dev/null"` 绕过；这类本机配置不要提交。
- `feature/dev` 已推送，不要重写已推送历史。
- 未明确要求时：不 commit、不改版本号、不动 `dist/`。
- 仓库有协作者：文档与提交里不写个人仓库地址、主机名、用户名、内网/代理地址、绝对家目录路径；示例统一用 `<user>` / `~/`。

## 3. 目录速查

```text
.github/workflows/       手动发布（Linux/Windows/macOS 各自独立）
src/                     React 前端
  app/                   外壳、主题、视口、全局样式
  components/            base、chatInput、messages、markdown、search、auth、session、settings、sider、files
  services/              api（client/SSE/files）、chat（store/reply/branches/db/drafts/backup/history）、settings、attachments、speech
  i18n/                  zh.ts（key 源头）、en.ts、index.ts
  utils/ assets/         工具、favicon、DM Sans 字体与许可证
gui/                     PySide6 管理界面（.venv 不提交）
  app.py                 薄入口
  cdgui/                 domain / infra / store / controller / ui / bootstrap
  parsing.py             CLI 中文输出解析（契约）
  gui_config.py          v3 config.gui.json（v1/v2 迁移）
  server_config.py       默认路径/监听/API 地址
  service_plan.py        systemd unit 与 service 命令
  theme.py fonts.py      配色、字号、系统字体
  assets/ tests/ README.md REFACTOR_PLAN.md BEHAVIOR_BASELINE.md
cmd/chat-deepseek/       CLI 入口
internal/                config/database/account/auth/secret/settings/chat/filestore/backup/service/deepseek/server/webui/cli
docs/                    架构、GUI、运维细节（见 §8）
```

- `README.md` 是唯一用户文档（中文）；不要再加英文版。
- 聊天历史格式细节在 `src/services/chat/history/README.md`。
- 代码风格由 oxfmt 决定（单引号、无分号、es5 尾逗号、100 列、2 空格）；Go 遵循 `gofmt`。
- `src` 约 21k 行；最大文件 `src/services/chat/store.ts`（约 1.1k 行）。

## 4. 不可破坏的契约

- **CLI 文本输出是契约**：`user list`、`whoami`、`backup list`、`备份已写入 <path>`、`serve` 启动前缀、`version` 格式都不能随意改；`info` 输出固定 `key=value`。改格式必须同步 `gui/parsing.py`、GUI 测试和 README。
- **退出码**：0 成功、1 运行错误、2 用法错误、3 未登录/过期、4 权限不足。
- **设置与 Key**：Key 只在服务端加密保存（AES-GCM + `master.key`），不返回前端、不写日志；API 地址由服务端 `--api-origin`/`config.json` 控制，前端没有编译期地址。
- **存储**：SQLite 是唯一数据源；前端只用 HttpOnly Cookie + 内存 CSRF，不引入 localStorage/IndexedDB；会话保存按 `version` 串行，409 不静默覆盖。
- **附件**：附件 `id` = 服务端文件 ID；服务端代理再换 DeepSeek `file_id`，不要恢复前端直传 DeepSeek 的旧路径。
- **备份**：服务运行或存在 `chat.db-wal`/`chat.db-shm` 时拒绝备份与恢复；`backup_dir` 优先级 `--backup-dir` > `config.json` > `data/backups`。
- **i18n**：所有用户可见文案走 `zh.ts` / `en.ts`，key 增删两边同步；`TranslationKey` 以 `zh.ts` 为准。
- **GUI 行为**：按钮可见/可用/文案只来自 `domain/rules.action_verdict` → `Verdict`；页面不自己判断权限或服务状态；`AppState` 里不放 `visible/enabled/loading/busy/pending`。
- **GUI 配置**：`config.gui.json` 为 v3（`connection` + `local`/`ssh` 两段 + 用户名），v1/v2 自动迁移；密码不落盘，只经 stdin/here-doc。
- **窗口外观**：标题栏、边框、对话框标题栏用系统原生，不做 frameless/透明顶层窗口/自绘外壳。
  Linux Wayland 会话里装饰由 Chromium 自绘（灰底方角），属既定取舍，不要为它去切 Ozone 平台
  （`appendSwitch` 只影响子进程，会让 GPU 崩在混合平台上，见 `desktop/README.md`）。
- **构建产物**：`internal/webui/dist/*` 不提交；改前端后要 `pnpm build` 才会进二进制。

## 5. 开发与验证

```sh
pnpm type && pnpm lint && pnpm build
go test ./... && go vet ./...
gui/.venv/bin/python -m unittest discover -s gui/tests
```

- 前端开发：先 `go run ./cmd/chat-deepseek serve --data-dir ./data-dev --listen 127.0.0.1:8091 --no-browser`，再 `pnpm dev`（8090 代理 `/api`）。
- 前端没有自动化测试；Go 与 GUI 有。新增前端测试框架前先问。
- 手动冒烟、CLI/GUI 验收清单、fake systemd/ssh 做法、发布流水线、环境限制见 `docs/operations.md`，按改动范围挑条目。
- 旧代码里的 `TODO`/`FIXME` 视为噪音，新代码不要留。

## 6. 高风险点

- `store.ts` 的 `historyEpoch`/`deletingSessions`/`unsavedSessions`/`pendingFiles`/`importingHistory` 等互相配合防竞态；新增动作必须复用，否则会「删除后写回」「导入覆盖新消息」。
- 消息树：`parentId`/`selectedChildId` 必须一致；新分支用 `appendBranch`，切换用 `selectVersion`，不要手改 `messages`。
- 上下文规则集中在 `reply.ts`；改它会影响继续生成、历史导入、重新生成，需一起验证。
- 流式只按动画帧刷内存，离开页面 `bindChatPersistence` 才 flush；新字段要能随 `persist`/`settleReply` 落盘。
- 历史替换会中止生成、清草稿与缓存；导入先上传新附件再由 `POST /import` 单事务替换，失败时旧数据不能动。
- 安全拒绝（`stop_reason: refusal`）丢弃已下发的思考与正文，只留模板；拒绝轮次不进上下文。
- `db.ts` 的 `versions`/`queues`：同一会话串行 PUT，新保存路径不能绕过 `saveSession`。
- 单个会话删除只清理不再被引用的附件；清空全部历史才调 `DELETE /files`。

## 7. 协作约定

- 流程：确认目标与验收 → 读相关模块与数据流 → 给影响面/方案 → 实现 → 门禁 → 按范围冒烟 → 汇报风险与未覆盖项。
- 大改动优先用子 agent，并给出**互不重叠的文件所有权**；root 负责接口钉死、验收、集成与最终 diff 复审。子 agent 不要 commit。
- 交付前必须自己跑门禁，并独立核对测试/ diff，不能只信子 agent 的汇报。
- 需要先确认的典型问题：功能扩展/UI 改版/底层重构？要不要兼容上游后续合并？是否允许新依赖或测试框架？验收用演示、截图还是自动化测试？
- 注释与文档用中文，解释「为什么」；不要复述代码。
- 不要为了通过检查而改测试断言；行为变了先改行为再改测试。

## 8. 状态与文档索引

当前（2026-11-27）：

- v1 服务端可用：账户/组、登录/CSRF、设置与 Key 加密、会话版本锁、附件、DeepSeek 代理、Web UI 嵌入、`info`/`config set`/`service`/`backup` 均已完成；`go test ./...`、`go vet ./...` 通过。
- 前端：`pnpm type`、`pnpm lint`、`pnpm build` 通过。无自动化测试。
- **桌面端改为 Electron**（`desktop/`），`gui/`（PySide6）是上一代外壳，只作为行为参考，不再加功能，最终删除。
  渲染层与主进程的桥是 `ipc`；浏览器仍只走 `/api/v1`，两条通道不要混用。
- `ipc` 控制面（`internal/ipc` + `docs/ipc.md`）已经可用：状态/能力/配置投影与写入、备份增删列、
  服务启停/安装与日志事件流、`auth.*` 登录态、`account.*` 账户管理；`ipcVersion` 为 1，
  新增方法算兼容增量。登录态沿用 CLI 会话文件但归属 ipc 进程，TTL 12 小时滑动续期。
- 桌面端视觉已定稿（`docs/desktop-visual.md`），设计系统在 `desktop/renderer/ui/`，
  四个页面（服务/账户/备份/设置）已接真实 `ipc`，浏览器里由 `app/mock-host.ts` 顶着同一份契约；
  `gui/` 的 Liquid Glass 试验已废弃，不要参考。
- 已知未覆盖：真机 SSH/systemd、Windows/macOS 桌面端验证、打包与自动更新；Electron 只在本机 Linux 桌面跑过。

细节文档：

- `docs/architecture.md`：分层、数据模型、API、CLI 契约、核心流程、v1 设计、高风险点、上游同步。
- `docs/ipc.md`：本地控制面契约（信封、错误码、方法表、事件、与 `/api/v1` 的分工）。
- `docs/desktop-visual.md`：桌面端视觉规范（层次、判据、尺寸、日志区）与核对方法。
- `docs/gui.md`：上一代 PySide6 GUI 的分层与行为基线（迁移参考）。
- `docs/operations.md`：门禁命令、手动冒烟与验收清单、发布流水线、版本规则、环境限制、历史决策。
- `desktop/README.md`：Electron 骨架、`ipc` 桥、平台差异与已知限制。
- `README.md`：用户安装、运行、数据说明。
