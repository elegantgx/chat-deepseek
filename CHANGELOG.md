# Changelog

只记录本分支相对 [chat-demo](https://github.com/deepseek-ai/chat-demo) 的变化；上游已有的聊天界面功能不重复。

## 0.1.5-official0.1.4 - 2026-11-27

### 桌面端

- 用 Electron 桌面端（`desktop/`）替换 PySide6 外壳：主进程只管窗口、单实例与请求转发，渲染层是独立设计系统的 React 页面。浏览器仍只走 `/api/v1`，桌面端走本机 `ipc`，两条通道不混用。
- `ipc` 控制面补全为可用版本：状态与能力投影、配置读写、备份增删列、服务启停/安装/卸载与日志事件流、登录态与账户管理。登录态沿用 CLI 会话文件但归属 ipc 进程，12 小时滑动续期。
- 服务页、账户页、备份页、设置页全部接真实 `ipc`；纯浏览器里由同一份契约的后端替身驱动，方便验收与截图，不另写 fixtures。
- 视觉定稿见 `docs/desktop-visual.md`：中性色阶、发丝线、语义色、亮暗两套主题；对话框改用独立表面色，不再借用玻璃底色。
- 移除 Wayland 下切 Ozone 平台的启动开关：`appendSwitch` 只影响子进程，会让 GPU 在混合平台上崩溃；无 GPU 环境退回软件合成。

### 服务

- 不装 systemd 也能用：没有单元时由桌面端托管本地 `serve` 子进程，关掉应用即停止；systemd 用户单元降级为可选的「开机自启 + 脱离桌面端运行」。
- 安装单元改成对话框：开机自启、安装后立即启动各自可选；linger 状态与 `loginctl enable-linger` / `disable-linger` 命令就地展示并可复制，安装结果的 warnings 回到界面，不再写进终端。
- 服务页可直接「打开页面」，也可在启动成功后自动打开一次；监听为 `0.0.0.0` / `::` / 空 host 时回落本机回环。
- 设置页支持切换数据目录（写入 `desktop.json`，重启生效），并可只读查看 unit 安装状态与 linger；连接方式暂只支持本机回环，SSH 入口如实标注未实现。

### 打包与发布

- 桌面端用 electron-builder 打包：Linux/macOS 出便携 zip（`-linux-amd64` / `-macos-arm64`），Windows 出单文件 NSIS 安装包（`-windows-amd64-setup.exe`），不再出 dmg/tar.gz；Go 后端（也是 CLI）随包放在 `resources/bin/`。
- 服务端只保留 Linux 的 headless ZIP（`-linux-server-amd64`，仅二进制与三份文档）；macOS/Windows 的纯服务端包并入桌面端包。
- 三条发布流水线去掉 PyInstaller/PySide6，改为「Web 构建 → Go 二进制 → 桌面端构建 → electron-builder → 发布」。

### 其它

- 移除 `gui/`（PySide6 外壳），桌面端由 `desktop/` 的 Electron 应用完全取代。

## 0.1.4-official0.1.4 - 2026-11-26

### 命令行

- 新增 `info`：只读输出固定 `key=value`（版本、路径、配置、初始化状态、systemd 状态），不创建数据库、`config.json` 或 WAL。
- 新增 `config set`：修改 `listen` / `public_url` / `api_origin` / `backup_dir`，保留 `config.json` 里的未知字段并原子写 `0600`；`backup_dir` 支持清空回默认。
- 新增 `service`：Linux systemd 托管，支持 user/system 两种范围（`install` / `uninstall` / `start` / `stop` / `restart` / `status`）。`install` 只生成 unit 并 `daemon-reload`，不启动；`--enable` / `--disable` 切换开机自启。`service --help` 列出全部子命令和 `--system` 说明。Windows/macOS 明确不支持，继续前台 `serve` 或平台 supervisor。
- `backup` / `backup list` / `backup restore` 统一按 `--backup-dir` > `config.json` 的 `backup_dir` > `data/backups` 解析备份地址。
- 退出码补齐用法错误 `2`；`info`、`config set`、`service` 不需要应用登录。

### 图形界面

- `config.gui.json` 升级到 v2（`version`、`connection`、`local{binary_dir,data_dir,username}`）；旧版顶层字段自动迁移，`backup_dir` 改由 `config set backup_dir` 写入 `config.json`。
- 设置页和服务状态改用 `info` / `config set`，GUI 不再直接读写 `data/config.json`；监听地址、Public URL、API 地址和备份地址保存后由 `serve` / `backup` 读取。
- Linux + systemd 增加服务卡片：显示服务安装位置（用户目录）、运行、开机自启和 linger 状态，支持启动、停止、重启、安装、更新和卸载；未安装时保留前台会话模式，关闭 GUI 不会停止 systemd 服务。
- 安装服务改为对话框，用下拉框选择用户目录或系统目录：用户目录直接安装；系统目录需要 root，GUI 不执行，只给出“安装命令”和“CLI 帮助”两条单行字段，各自带「复制」按钮，单行显示不下时中间省略，复制的是完整命令。用户目录可选开机自启和安装后立即启动；linger 行按当前状态给出 `enable-linger` 或 `disable-linger` 命令。更新服务用 `service install --force` 按当前配置重写 unit，并可在对话框里调整开机自启；更新后统一走 `service restart`，且显式写入 `--enable` 或 `--disable`，避免 GUI 缓存状态导致旧进程继续运行或开机自启状态不一致；更新、启动、停止、重启或卸载失败时先刷新状态再显示错误，不再静默无反馈。
- 安装/更新对话框沿用设置页的表单样式：不再展示不可修改的 unit、可执行文件和数据路径，只保留“安装位置”和命令；下拉框与 40px 字段同高，linger 和系统命令都用 secondary「复制」按钮。
- Windows/macOS 不支持 systemd，继续使用会话模式；常驻交给平台 supervisor。
- GUI 测试增加到 91 个，新增 v1→v2 迁移、`info` 解析、设置写 `config.json`、service 命令拼装和 fake systemd 服务流程验证。

## 0.1.3-official0.1.4 - 2026-11-25

### 上游同步

- 合并上游 `v0.1.4`：历史导入新增进度条，附件按会话随归档一起读取，ZIP 读取改为读窗口缓存与按需随机访问，并补上旧浏览器兼容。
- 导入进度按已处理会话数显示；关闭设置再打开仍能看到进行中的导入，关闭时会清理待确认状态。
- 导入时从图片原件识别 MIME 并回填到会话附件，上传后服务端能返回正确的 `Content-Type`。
- 版本号 `0.1.3-official0.1.4`，代码基线上游 `v0.1.4`。

## 0.1.2-official0.1.3 - 2026-11-25

### 命令行

- 新增 `login`、`logout`、`whoami`：登录态按 shell 隔离，固定 15 分钟过期；token 只放在用户运行时目录，数据库保存哈希。
- `user ...` 和 `backup ...` 现在需要登录并按组校验：`Admin` 管理普通 `User`，`Owner` 负责授组、操作 `Admin`/`Owner` 和备份恢复；未登录退出码 `3`，权限不足 `4`。
- 认证会话增加 `scope`（schema v5），浏览器 Cookie 与 CLI token 不能互相冒用。

### 管理界面

- GUI 适配 CLI 登录：未登录时账户区显示锁图标、备份区提示登录后查看；点登录、刷新、添加或备份会弹出登录框，密码仍只经 stdin 传给子进程。
- 账户操作按当前身份置灰：Admin 只能管理普通 User，不能授组或备份；Owner 可以授组、备份和操作 Admin/Owner；不能禁用或删除自己。
- 登录态绑定 GUI 进程，15 分钟过期，关闭窗口自动 `logout`；切换数据目录或恢复备份后需要重新登录。
- `config.gui.json` 记住上次登录的用户名，不保存密码。
- 修复暗色系统直接启动时被 Fusion 浅色调色板误判为亮色的问题：先读平台调色板，再切换 Fusion；GNOME 下额外读取 `gsettings` 的 `color-scheme` / `gtk-theme`，并用 `dconf watch` 跟随系统主题切换，不依赖 Qt 延迟上报的 `colorScheme`。

## 0.1.1-official0.1.3 - 2026-11-23

### 服务端

- 修复 Windows 上 `setup` 初始化时 SQLite 报 `invalid uri authority: C:` 的问题：数据库路径现在生成合法的 `file:///C:/...` URI，相对数据目录也会先解析成绝对路径。

## 0.1.0-official0.1.3 - 2026-11-23

首个自托管版本。

### 服务端

- 新增 Go 服务端并内嵌 Web UI；账户、会话、附件、设置和 API Key 全部保存在 `data/`，浏览器不再使用 localStorage/IndexedDB。
- 新增 `Owner` / `Admin` / `User` 组与账户管理；最后一名 Owner 受保护；Web 登录后可修改自己的用户名、密码、头像和 API Key。
- 密码使用 Argon2id；登录使用 HttpOnly Cookie、CSRF 和限流；API Key 使用 AES-GCM 加密，主密钥单独保存。
- 会话和附件按用户隔离，会话带版本锁；DeepSeek 请求由服务端代理，API Key 不下发浏览器。
- 新增 `setup`、`serve`、`user ...`、`backup ...` CLI；数据目录可整体搬移。

### 备份

- `backup` 生成数据目录 ZIP；`backup list` 按时间列出备份；`backup restore` 恢复 `config.json`、`chat.db`、`master.key` 和 `files/`。
- 支持自定义备份目录；服务运行中或存在 SQLite WAL/SHM 时拒绝备份或恢复。

### 管理界面

- 新增 Python/PySide6 管理界面，覆盖初始化、服务启停、账户管理、备份和命令输出；窗口使用系统原生标题栏。
- Windows 可执行文件和 macOS `.app` 使用鲸鱼应用图标；macOS 发布包改为只含一个 DMG。
- 启动时自动读取最近备份；备份记录可直接恢复；已知错误翻译成可操作提示，无法识别时才显示原始输出。
- GUI 设置持久化：二进制、数据、备份路径写入用户配置目录的 `config.gui.json`，监听地址、Public URL 和 API 地址写入数据目录的 `config.json`。

### 发布

- 提供 Linux/Windows ZIP 和 macOS DMG；Linux/Windows 根目录的 `src/` 为完整项目源码（内部保留前端 `src/src/`），macOS ZIP 只含 DMG。
- Linux 包不再附带 GUI 二进制，改为附带 `gui/` 源码，体积明显减小；Windows 仍附带预编译 GUI。
- macOS DMG 只有 `.app` 和 `/Applications` 链接；CLI、预配置的 `config.gui.json` 和文档都在 `.app` 内，数据目录默认在 `~/Library/Application Support/chat-deepseek/`。
- 三个平台各自通过 GitHub Actions 手动构建；在 tag 上运行会创建或更新 GitHub Release。

### 注意

- 从上游 chat-demo 升级时，浏览器里的旧 localStorage/IndexedDB 数据不会自动迁移；先在旧版导出历史 ZIP，再在新版导入。
- `file://` 静态页面不再支持，请通过 `chat-deepseek serve` 使用。
