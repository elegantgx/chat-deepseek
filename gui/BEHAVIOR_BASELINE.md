# GUI 行为基线（重构验收用）

> 基线：`feature/dev` @ `07a50ce`，`gui/tests` 117 个用例通过。
> 用途：大重构的验收清单。重构后逐条对照，**文案与副作用顺序都算契约**；允许改的只有 §8 明确列出的 12 处不一致。
> 完整逐行清点依据：`app.py`、`dialogs.py`、`parsing.py`、`ssh_session.py`、`cli.py`、`service_plan.py`。

## 1. 全局机制（必须保住）

| 机制 | 可观察行为 |
|---|---|
| 单命令串行 | 有命令在跑时，新操作只 toast `正在执行上一条命令`，不排队、不执行 |
| busy 外观 | 等待光标；可操作控件置灰；结束恢复 |
| 线程回投 | 30ms 主线程泵；窗口关闭后回调全部丢弃 |
| 登录心跳 | 每秒刷新剩余时间；过期立即回未登录并 toast `登录已过期，请重新登录` |
| 超时 | `backup` 1800s，其余 120s；SSH 超时按 255 处理 |
| 密码 | 只经 stdin（本机 `--password-stdin`，远端 here-doc），永不进 argv |
| 退出码 | 0 成功、1 运行错误、2 用法、3 未登录/过期、4 权限不足 |
| 失败文案 | 已知失败由 `parsing.explain_failure` 翻成可操作说明；识别不了才显示 `未知错误` + 原始输出 |
| 成功但解析失败 | `未知错误` / `无法处理 chat-deepseek 返回的结果。` + 原始 stdout |
| 远端 255 | 关通道、清登录、toast `SSH 连接已断开，请重新登录`、弹 `SSH 连接失败`；下一条命令自动重连 |
| 远端 127 | 弹 `找不到 chat-deepseek`，不显示"未知错误" |

## 2. CLI 参数（重构后逐条断言 argv 顺序）

| 入口 | argv | stdin |
|---|---|---|
| 登录 | `login --username <u> --password-stdin [--data-dir D]` | `<password>\n` |
| 读身份 | `whoami [--data-dir D]` | — |
| 账户列表 | `user list [--data-dir D]` | — |
| 添加用户 | `user add [--data-dir D] (--group G)* --password-stdin <u>` | `<password>\n` |
| 重置密码 | `user reset-password [--data-dir D] --password-stdin <u>` | `<password>\n` |
| 启用/禁用 | `user enable|disable [--data-dir D] <u>` | — |
| 授组/撤组 | `user grant|revoke [--data-dir D] <u> <Group>` | — |
| 删除账户 | `user delete [--data-dir D] --yes <u>` | — |
| 创建 Owner | `setup --username <u> --password-stdin [--data-dir D] [--listen L]` | `<password>\n` |
| 退出登录 | `logout [--data-dir D]` | — |
| 立即备份 | `backup [--data-dir D]` | — |
| 备份到 | `backup --output <target> [--data-dir D]` | — |
| 备份列表 | `backup list [--data-dir D]` | — |
| 恢复备份 | `backup restore --yes [--data-dir D] <name>` | — |
| 前台服务 | `serve --no-browser [--data-dir D]`；远端包 `printf PID; exec …` | — |
| 服务信息 | `info [--data-dir D]` | — |
| 写服务端配置 | `config set <key> <value> [--data-dir <目标>]` | — |
| 安装服务 | `service install [--enable] [--force] --data-dir D` | — |
| 更新服务 | `service install --enable|--disable --force --data-dir D` | — |
| 启/停/重启/卸载 | `service start|stop|restart|uninstall` | — |
| 帮助 | `help` | — |
| 远端停 serve | `kill -TERM <pid>` | — |

## 3. 入口映射（现状 → 新位置）

| 现状 | 新位置 | 必须保留 |
|---|---|---|
| 顶部身份区 / 登录 / 退出 | 顶栏身份 chip | 未登录锁图标 + `未登录`；已登录 `<u>（角色） · 剩余`；tooltip 三行账户/组/过期 |
| `设置`（弹窗 448 行） | 导航"设置"页 | 连接方式、两套路径、四项服务端配置、恢复默认、逐项校验文案 |
| 服务卡 启动/停止/重启 | 服务页主操作 | 未安装走前台；已安装走 `service`；启动后按开关自动开页面 |
| 服务卡 安装/更新/卸载 | 服务页 `⋯` 菜单 | 安装对话框用户/系统两种形态；系统级只复制命令；卸载确认文案 |
| 服务卡 打开页面 | 服务页次操作 | 本机：serve URL > Public URL > listen 推导；远端只认 Public URL |
| 服务卡 自动打开开关 | 服务页开关 | 默认开；不持久化（现状如此，不趁机加） |
| 服务状态 pill / 详情 / 安装位置条 | 服务页状态区 | 六种胶囊/详情组合、开机自启/linger badge、linger 复制命令 |
| 账户 刷新/添加/列表/选择 | 账户页 | 60px 行、组标签排序、禁用色、三态空态、数量 chip |
| 账户 重置密码/禁用/授予/撤销/删除 | 账户页底栏 | 权限置灰理由与 tooltip；自己不可禁用/删除；Owner 可重置自己 |
| 数据 立即备份/记录/备份到 | 备份页 | 摘要四态、恢复确认、备份地址、远端"备份到"隐藏 |
| 页脚 版本/命令行帮助 | 状态栏 | 版本串含 `· SSH <host>`；`help` 弹完整 stdout |
| 登录/创建 Owner/添加/密码/组/确认/消息 | Sheet 对话框 | 全部校验文案与默认焦点 |
| 备份记录弹窗 | 保留弹窗 | 58px 行、时间/大小/文件名、恢复所选 |

## 4. 服务状态矩阵

| 状态 | 启动 | 停止 | 重启 | 安装 | 更新 | 卸载 | 打开页面 |
|---|---|---|---|---|---|---|---|
| `info` 未返回 | ✓ | ✗ | 隐 | 隐 | 隐 | 隐 | ✗ |
| 未初始化 | ✓（会失败） | ✗ | 隐 | ✗ | 隐 | 隐 | ✗ |
| 未安装 systemd | ✓（前台） | ✗ | 隐 | ✓ | 隐 | 隐 | ✗ |
| 已安装未运行 | ✓ | ✗ | ✗ | 隐 | ✓ | ✓ | ✗ |
| systemd 运行中 | ✗ | ✓ | ✓ | 隐 | ✓ | ✓ | ✓ |
| 前台运行中 | ✗ | ✓ | 隐 | ✓ | 隐 | 隐 | ✓ |
| 正在停止 | ✗ | ✗ | ✗ | 按状态 | 按状态 | 按状态 | ✗ |
| `info` 读取失败 | ✓（前台） | ✗ | 隐 | 隐 | 隐 | 隐 | ✗ |
| 平台不支持 systemd | ✓ | ✗ | 隐 | 隐 | 隐 | 隐 | 运行中才可用 |

胶囊/详情：`尚未启动`/`正在读取服务状态…`；`运行中`/`systemd 服务`；`已停止`/`systemd 服务 · 已安装`；`未运行`/`未安装 systemd 服务（前台运行）`；`未运行`/`当前平台不支持 systemd 服务（前台运行）`；前台由日志驱动 `启动中…`→`运行中`（`监听 …`/URL）→`正在停止…`。

## 5. 登录 / 权限矩阵

| 状态 | 身份区 | 账户列表 | 备份按钮 | 账户动作 |
|---|---|---|---|---|
| 未初始化 | 锁 + `未登录`；登录禁用 | `创建 Owner` 空态 | ✗ `数据目录还没有初始化` | ✗ `请先登录` |
| 未登录（已初始化） | 锁 + `未登录` | 锁定空态 + 登录 | ✓（先弹登录；远端"备份到"✗） | ✗ `请先登录` |
| Admin | `<u>（Admin） · N 分钟后过期` | 真实列表 | ✗ `需要 Owner 权限` | 仅能操作更低 rank 的 User；授/撤组 ✗；自己 ✗ |
| Owner | `<u>（Owner） · …` | 真实列表 | ✓ | 授/撤组、操作其他 Owner；自己仍不能禁用/删除 |
| 过期 | 1s 内回未登录 + `登录已过期，请重新登录` | 锁定空态 | 回未登录规则 | ✗ |
| SSH 断开 | 回未登录 + `SSH 连接已断开，请重新登录` | 锁定空态 | 同上 | ✗ |
| 命令返回 3 | 回未登录 + `登录已失效，请重新登录` | 锁定空态 | 同上 | ✗ |

备份摘要四态：未登录 `登录后查看备份记录`；非 Owner `需要 Owner 登录才能查看备份`；无记录 `还没有备份记录`；有记录 `最近备份：YYYY-MM-DD HH:MM:SS（size）`。

## 6. 远端差异（逐项验收）

| 机制 | 本机 | 远端 |
|---|---|---|
| `data_ready` | `chat.db` 存在 | `info.initialized` |
| `page_url` | serve URL > Public URL > listen 推导 | 只认 Public URL，否则空 |
| 二进制 | 目录或文件，`.exe` 按平台 | 固定 `<dir>/chat-deepseek`，绝对路径 |
| 执行 | `Popen` | 常驻 `ssh -T <host> 'exec /bin/sh'`，同一 shell 串行 |
| `--data-dir` | 展开 `~` | 原样；留空由 `info` 回填 |
| 切换目标 logout | 旧二进制跑 `logout` | 必须走旧常驻通道（登录态绑 shell），断了只能等过期 |
| 关闭时 logout | 直接跑 `logout` | 经常驻通道跑，然后关通道 |
| 备份到 | 可选路径 | 隐藏；备份写到远端 `backup_dir` |
| 前台 serve 停止 | `terminate()` | 先按 marker PID `SIGTERM`，再兜底结束本地 ssh |
| 255 | — | 关通道 + 清登录 + 提示重连 |
| 127 | — | 弹 `找不到 chat-deepseek` |
| 版本标签 | `version · os/arch` | 追加 ` · SSH <host>` |
| linger | 注销后停止 | 断开 SSH 后即停止 |
| 旧备份地址迁移 | 写回本机 `config.json` | 跳过 |

## 7. 关闭窗口顺序

1. 前台 `serve` 运行 → 确认框 `服务还在运行。停止服务并退出？`；取消则不关。
2. `server_stopping = True`，停前台（本机 terminate→5s kill；远端 PID SIGTERM→兜底 ssh；主线程最多等 8s）。
3. `closing = True`，此后回调、toast、错误框全部抑制。
4. 停 30ms 泵与 1s 身份定时器。
5. 已登录则尽力 `logout`（5s，异常吞掉）。
6. 关 SSH 通道（exit→1s→terminate→2s→kill）。
7. `accept()`。

不会发生：停 systemd 服务；接管外部 serve；未登录时发 `logout`（但仍会关通道）。

## 8. 重构要顺手修掉的 12 处不一致

| # | 现状 | 重构后 |
|---|---|---|
| 1 | 远端 systemd 启动后可能自动开页面（开关禁用但默认勾选），远端前台却不自动开 | 统一按 `page_url`：有可打开地址就开一次；远端开关不再禁用 |
| 2 | 换数据目录不停旧前台 serve，旧进程继续占端口/旧目录 | 任何 `Target.key` 变化都先停旧前台（远端按 PID SIGTERM） |
| 3 | 远端 serve 把远端 loopback URL 写进状态详情 | 标成"远端监听 …（本机不可直连）"，不写成可打开地址 |
| 4 | 未初始化时登录按钮禁用，tooltip 仍写"登录 CLI 管理账户" | tooltip 改"先创建 Owner"；账户页给 CTA |
| 5 | 禁用控件 tooltip 在部分平台不显示，难验收 | 测试断言 `toolTip()` 属性，不模拟悬停 |
| 6 | 设置要求二进制目录，主窗口却允许直接给文件 | 统一 `resolve_target`：目录或文件都接受 |
| 7 | 安装对话框 `value["scope"]` 恒为 `user` | `InstallOptions.scope` 带真实值，controller 只对 `user` 执行 |
| 8 | 复制按钮变 `已复制` 后不恢复 | `CopyRow` 1.5s 复位 |
| 9 | `info` 失败保留旧值但界面无提示，首次失败停在"正在读取" | 保留事实，标 `info_state=error` + 重试 |
| 10 | `gui_config.save` 失败发生在 `config.json` 已写之后 | "应用切换"与"保存配置"拆开，先落本地配置再切；失败不半切换 |
| 11 | 备份成功后列表不刷新，要重开弹窗才更新 | 成功后 `invalidate(BACKUPS)` + 重读 |
| 12 | 登录失败关掉弹窗再重开一个 | 登录 sheet 就地显示错误，不重开 |

## 9. 跨流程约束（20 条）

1. 登录后先 `whoami` 再 `user list`/`backup list`，最后才执行用户动作；避免 SQLite 并发假错。
2. `identity` 非 Admin/Owner → 清态并提示 `没有管理权限`。
3. 切连接/主机：旧目标 logout → 停旧前台 → 关旧通道 → 清 info/service 标志 → 重读 info → 提示重新登录。
4. 切数据目录：同 3；且必须停旧前台（修复项 2）。
5. 恢复备份后：清选中/备份、重算 data_ready、重读 info、清登录、提示 `请重新登录并启动服务`。
6. 重置自己的密码：立即掉线并提示。
7. 任何命令返回 3：先清登录态（作废在途结果）再走失败回调。
8. 过期与命令 3 的 toast 文案不同，分别断言。
9. 创建 Owner 后：`data_ready=True`、重读 info、弹预填用户名的登录框；取消则停在锁定态。
10. 账户变更后重新读身份，成功会顺带刷新列表/备份。
11. 只有原本有登录态且目标变化时才 logout 旧目标；失败静默，等 15 分钟过期。
12. 设置保存遇 busy：现状直接丢弃修改；新页面改为禁用保存并保留草稿。
13. 目标主机配置读取中禁止保存。
14. 远端首次开设置要等 `info`，最长 2.5s 兜底。
15. 安装后立即更新本地状态，避免 `info` 回来前又被当成未安装走前台。
16. 更新服务一律 `restart`，不按缓存状态分支。
17. systemd 启停/重启/安装带启动前，先停 GUI 自己的前台会话。
18. 服务命令失败：先刷新 `info` 再弹错误，不能静默。
19. 登出/切目标后，旧 `whoami`/`user list`/`backup list`/serve 行结果必须作废。
20. 旧备份地址迁移：仅本机、仅 v1 legacy、仅 `info.backup_dir` 仍为默认时写回。

## 10. 测试缺口（重构必须补上）

- `app.py` 无任何测试：状态机、按钮矩阵、登录/pending 顺序、登出/过期、切目标副作用、备份恢复、serve 日志、SSH 失败、关闭顺序、全部 toast 文案。
- `dialogs.py` 除设置外无测试：登录/账户/密码/组/备份/安装/确认/消息的文案与校验。
- `widgets.py` 无渲染/交互测试；`theme.py` 不测配色/QSS。
- 无真实子进程、systemd、ssh、浏览器的端到端测试。
- 无跨平台 GUI 测试（Windows/macOS 仅人工）。
