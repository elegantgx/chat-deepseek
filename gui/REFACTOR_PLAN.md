# GUI 大重构方案

> 状态：方案稿，未动源码。
> 目标：把 `gui/` 从"单窗口 + 上帝对象 + 手工刷新"改成"领域模型 + 单一渲染 + 分页"，一次切换到位。
> 不在本方案内：新增用户功能、修改 Go 服务端、改 CLI 契约、引入新依赖。

## 0. 结论先行

| 决策 | 选择 | 理由 |
|---|---|---|
| 节奏 | **一次性大重构**，中间态不要求可运行 | 先拆视图再改信息架构会把视图按旧四卡片定型，P2 必然推翻重来，等于用重构制造补丁 |
| 主窗口 | **左侧导航 + 四页**：服务 / 账户 / 备份 / 设置 | 纵向稀缺（账户列表现状仅 150px）、横向富余（936px）；导航放左侧不向账户列表收税 |
| 设置 | **从弹窗改成页面** | `_fit_height()`、两套行共用一张网格、跨主机只读展示，都是"弹窗放不下"的产物；成页后整段删除 |
| 备份 | **独立成页** | CLI 在服务运行时会拒绝备份；弹窗里遇到拒绝只能关窗→停服务→重开，成页后可把"先停服务"做成页内前置条件 |
| 安装/更新服务 | **保留弹窗**（sheet），不进导航 | 它是一次带 4 个选项的命令确认，不是"一个地方"；进页面会多一层返回且无收益 |
| 跨主机配置 | **只编辑当前 target**，不缓存另一台的只读副本 | 另一台的 `config.json` 在另一台机器上；想改就切过去。现有 `_server_values`、`_load_server_values`、只读提示一次删除 |
| 服务操作 | **1 主 + 1 次 + 溢出菜单** | 启动/停止是日常，重启偶尔，安装/更新/卸载低频且危险，不能与"打开页面"平权 |

## 1. 现状证据（为什么必须大改）

- `app.py`：2922 行、127 个方法、86 个实例属性、23 处 `_execute`、10 处裸 `threading.Thread`，**零测试**。
- 手工刷新扇出：`_update_buttons()` 21 次、`_update_service_ui()` 8 次、`_update_backup_placeholder()` 8 次、`_update_identity_ui()` 7 次。每加一条流程都要记得补 3~5 个 update。
- 同一事实多份真值：`local_profile/ssh_profile` 与拍平的 `connection/binary_dir/data_dir/last_username`；`info.service_*` 与 5 个窗口布尔（`service_active` 在 8 处赋值）；`listen/public_url/api_origin/backup_dir` 在窗口、对话框、`config.json` 三份。
- "远端"是 39 处 `if self.remote`，不是能力抽象。
- 异步靠 10 个手工字段协调：`busy / users_loading / backups_loading / settings_pending / server_stopping / pending_action / session_generation / info_generation / server_generation / _ssh_lock`。
- 布局实测（1000×760）：服务卡 174px、账户列表视口 161px（2.7 行）、数据卡 97px；900×740 下列表只剩 150px。窗口 chrome 约 197px。
- 控件：`widgets.py` 1427 行、21 个 `paintEvent`；7 种按钮高度、10 种最小宽度、6 种字号；`StatusPill / StatusBadge / GroupChip` 三套胶囊。

## 2. 目标形态

### 2.1 窗口骨架

```text
┌────────────────────────────────────────────────────────────────────────┐
│ ⊗ chat-deepseek  [本机  ▾]   ● 运行中 · 前台会话      [gx Owner 12′ ▾] │ 56
├──────────┬─────────────────────────────────────────────────────────────┤
│ 服务   ● │                                                             │
│ 账户   3 │                     当前页内容（可滚动）                     │
│ 备份   2 │                                                             │
│          │                                                             │
│ 设置     │                                                             │
├──────────┴─────────────────────────────────────────────────────────────┤
│ 0.1.4 · linux/amd64          最近备份：11-26 03:12 · 2.1MB   命令行帮助 │ 28
└────────────────────────────────────────────────────────────────────────┘
```

- **顶栏** 56px：品牌、`TargetChip`（本机/SSH + 主机 + 数据目录短名，点击弹目标菜单）、服务状态 pill（点击跳服务页）、身份 chip（用户名/角色/剩余时间，点击登录或退出）。忙碌时 chip 旁 12px 转圈。
- **左侧导航** 156px，4 项、44px 行高；服务项 6px 状态点，账户/备份项数字徽标（未登录显示 `—`）。
- **状态栏** 28px：版本 · 平台、最近备份（点击跳备份页）、命令行帮助。不再承载主机信息。

旧的四卡片结构取消：独立的"数据"卡片并进备份页，服务卡压成状态区 + 单排操作，账户列表拿到剩余高度。

窄宽降级（900px 最小宽）：品牌只留标志；`TargetChip` 省略数据目录，仅剩 `本机` / `SSH nas`；身份 chip 只留头像 + tooltip；导航保持文字（图标+文字在 156px 内本来就够）。

### 2.2 页面规格

**服务页**

```text
Card 状态
  SectionHeading("服务") + status_detail + stretch + StatusPill
  [启动/停止]（同一个 primary，按运行态切换） [重启] [打开页面] [⋯]
  （右侧）启动后打开页面 [开关]（远端禁用；不持久化，与现状一致）
Panel 运行方式：systemd 用户服务 / 前台会话 / 当前平台不支持
  · 监听地址 · Public URL · 数据目录（Elided + 复制）
Card 运行详情
  安装位置（Elided + 复制） · 开机自启 Badge · linger Badge（未开为 warning，附复制命令）
  未安装时尾部 link："改为 systemd 常驻…" → 安装弹窗
Card 运行日志（仅前台会话，可折叠）最近 40 行 + 复制
```

`⋯` 菜单：安装服务 / 更新服务 / 卸载服务 / 复制 unit 路径 / 复制打开页面命令 / 命令行帮助。
危险项在菜单里带一行后果说明；卸载进确认对话框，数据目录不动。

状态分支：
- 未初始化：状态卡显示"数据目录未初始化"，主按钮变"创建 Owner"跳账户页；不显示启停。
- 未安装 systemd：主按钮走前台会话，详情卡尾部出现"改为 systemd 常驻…"。
- 远端且 Public URL 为空：隐藏"打开页面"（不是置灰），tooltip 说明 GUI 不做端口映射。
- 远端前台会话：日志里的监听地址标成"远端监听 …（本机不可直连）"，不写成可打开 URL。
- 前台会话运行中：显示日志卡；systemd 模式隐藏日志卡。

**账户页**

```text
HBox 页头：SectionHeading("账户") + 数量 chip + stretch + 刷新 + "+ 添加"
QScrollArea → UserRow × N（60px，选中长胶囊）
Panel 底栏 52px：已选择/账户操作 + 用户名 + 取消选择 + stretch + 重置密码/禁用/授予组/撤销组 + 竖线 + 删除
```

列表视口从 150px 提升到约 470px（7.8 行）；键盘 ↑/↓/空格/Enter 可用。

空态：未初始化 → "创建第一个 Owner" CTA（弹账户对话框）；已初始化未登录 → 锁图标 +
"登录后管理账户" + 登录按钮；已登录但列表为空 → "+ 添加"引导。

**备份页**

```text
HBox 页头：SectionHeading("备份") + 备份地址（Elided + 复制）+ stretch + 立即备份 + 备份到… + 刷新
[前置条件条] 服务运行中 → Panel(warning)："备份需要先停止服务" [停止服务]（单独二次确认）
QScrollArea → BackupRow × N（时间 / 大小 / 文件名）
Panel 底栏：已选择 xxx + stretch + 恢复所选（danger，二次确认）
```

远端时"备份到…"隐藏（不是置灰），tooltip 说明备份写到远端配置地址；未登录时整页锁图标 + "Owner 登录后查看"。

恢复确认必须复述被覆盖的文件：`chat.db`、`config.json`、`master.key`、`files/`，并提示"请确认服务已停止"。

**设置页**

```text
Card 连接
  SelectField(本机 / SSH 远程)
  本机：二进制目录 PathRow、数据目录 PathRow
  SSH：SSH 主机、远端二进制目录 PathRow、远端数据目录 PathRow
  [测试连接] [应用切换]
Card 当前主机的服务端配置
  标题旁 chip："来自 <主机> 的 config.json"
  备份地址 PathRow、监听地址、Public URL、API 地址
  [保存配置]
Card 管理登录：身份 / 组 / 过期时间 / [退出登录]
Card 关于：版本 / 平台 / 命令行帮助
```

两张卡各自提交，**没有全局 OK**：

- "应用切换"改的是 `Target`：停旧前台 → 旧目标 logout → 关旧 transport → 重读 `info`；失败保留旧 target，不半切换。
- "保存配置"只对当前 target 生效：逐项 `config set`，成功后重读 `info`，不用表单值直接当事实。
- 切走之前检查连接卡是否有未保存改动，拦一次。
- 二进制目录的校验统一用 `resolve_target` 的规则（目录或可执行文件都接受），修正现状"设置里必须是目录、主窗口允许文件"的两套规则（`dialogs.py:845-847` vs `app.py:899-900`）。

### 2.3 跨页共享状态

常驻顶栏三件：`target`、`service`、`identity`。页面只读，不允许自己改主机或身份。

当前页 `page: PageId` 是交互事实，导航和 `Ctrl+1..4` 都走同一个 reducer；页面选择与 target 无关，切目标不自动跳页。

页面切换保留：

- 选中账户按 `username` 存，不按 index；
- 滚动位置：重渲染前存 `verticalScrollBar().value()`，渲染后 `QTimer.singleShot(0, ...)` 恢复；
- 页面对象常驻 `QStackedWidget`，表单草稿天然保留；设置页 `can_leave()` 守卫未保存改动；
- 非当前页只标 `dirty`，不立即重排；切到该页再 `render`。

### 2.4 视觉与键盘

- 尺寸/间距/字号全部走 `tokens`（见 §6），页面代码里不出现魔法数字。
- `Ctrl+1..4` 切页，`Ctrl+,` 进设置；Tab 顺序：顶栏 → 导航 → 页面内容 → 状态栏。
- `UserRow` 改 `Qt.StrongFocus`，↑/↓ 移动、空格切换选中、Enter 打开操作；危险操作不绑单键。
- 状态不只靠颜色：运行方式写文字，linger 未开带文字说明。
- 确认对话框默认焦点在"取消"；恢复备份默认焦点在列表首行。

## 3. 领域模型

### 3.1 事实（只能由 I/O 或用户输入写入）

| 事实 | 来源 | 不变量 |
|---|---|---|
| `Endpoint` | `config.gui.json` | local 必须有本机可执行文件；ssh 的 host、binary_dir 非空且绝对 |
| `Target` | `resolve_target(Endpoint)` | 冻结；`key` 唯一；`data_dir==""` 仅允许 ssh |
| `HostConfig` | `info` | 带 `target_key`；四项服务端配置只存在这里 |
| `ServiceStatus` | `info` | 只能整块替换；`active ⇒ installed` |
| `Identity` | `whoami` | 必须属于当前 `target_key`；无身份 ⇒ users/backups 为空 |
| `users / backups` | `user list` / `backup list` | 仅在已登录且权限足够时存在 |
| `ForegroundSession` | `serve` 日志/退出 | 同时最多一个，`target_key` 必须等于当前 target |
| `inflight` | `CommandRunner` | 每个 `TaskKey` 最多一个，generation 严格递增 |

```python
class ConnectionKind(StrEnum):
    LOCAL = "local"
    SSH = "ssh"

class Capability(StrEnum):
    FOREGROUND_SERVE = "foreground_serve"
    OPEN_PAGE = "open_page"
    SAVE_BACKUP_AS = "save_backup_as"
    PICK_LOCAL_PATH = "pick_local_path"

@dataclass(frozen=True)
class Target:
    endpoint: Endpoint
    binary: str
    data_dir: str          # "" 仅 SSH：交给 CLI 默认值

    @property
    def key(self) -> str: ...          # f"{kind}|{host}|{binary}|{data_dir}"
    def supports(self, cap: Capability) -> bool: ...

@dataclass(frozen=True)
class ServiceStatus:
    supported: bool = False
    installed: bool = False
    active: bool = False
    enabled: bool = False
    linger: bool = False
    scope: str = ""
    unit: str = ""

@dataclass(frozen=True)
class HostConfig:
    target_key: str
    version: str
    os: str
    arch: str
    initialized: bool
    listen: str
    public_url: str
    api_origin: str
    backup_dir: str
    service: ServiceStatus
```

### 3.2 派生（纯函数，绝不落状态）

- `is_running = foreground is not None or (host.service.installed and host.service.active)`
- `data_ready` 由 `host.initialized` 或已登录状态推导
- `page_url`、`service_mode`、`backup_reason`
- `ActionId -> Verdict`：`enabled / visible / text / tooltip / reason`
- 身份剩余时间、账户区空态（setup / locked / list）、设置页可编辑性

**所有"能不能点"只由 `domain/rules.py` 回答**，页面和 controller 不得自己写 `if identity.is_owner` 或 `if service_active`。

### 3.3 不变量（`assert_invariants(state)`，Store 每次 update 和测试都调用）

1. `identity / hosts[target.key] / foreground` 的 `target_key` 与 `state.target.key` 全等；
2. 无身份 ⇒ `users`、`backups`、`selected` 为空；
3. `selected ∈ users`；
4. 每个 `TaskKey` 的 inflight 唯一且 generation 单调；
5. `HostConfig.service` 只能来自 `ServiceStatus.from_info`；
6. 关闭后不再有回调落地。

## 4. 状态容器与单一渲染

```python
class Store:
    @property
    def state(self) -> AppState: ...
    def update(self, reducer: Callable[[AppState], AppState]) -> None: ...
    def subscribe(self, listener: Callable[[AppState], None]) -> Callable[[], None]: ...
```

`update`：`new = reducer(old)` → `assert_invariants(new)` → 赋值 → 通知。reducer 全是纯函数，放 `cdgui/domain/reducers.py`，可脱离 Qt 单测。

窗口只订阅一次：

```python
def _schedule_render(self, _state: AppState) -> None:
    if not self._dirty:
        self._dirty = True
        QTimer.singleShot(0, self._render)

def _render(self) -> None:
    self._dirty = False
    render.apply(derive_ui(store.state, now=datetime.now()), self.views)
```

`apply` 对每个控件做幂等 `setVisible/setEnabled/setText/setToolTip`，只在变化时写。

**删除的旧机制**：21 处 `_update_buttons()`、8 处服务 UI、8 处备份占位、7 处身份 UI、`busy/loading/pending` 全部由 `inflight` 和纯函数取代。`UiState` 是纯投影，测试不需要建窗口。

## 5. 命令层

### 5.1 参数构造（纯函数）

`cdgui/domain/commands.py`，一个 CLI 动作一个函数，UI 不再拼 argv：

```python
@dataclass(frozen=True)
class CommandSpec:
    argv: tuple[str, ...]
    stdin: str | None = None
    timeout: float = 120.0

def login(t: Target, username: str, password: str) -> CommandSpec: ...   # 密码走 stdin
def info(t: Target) -> CommandSpec: ...
def user_add(t: Target, name: str, password: str, groups: Sequence[str]) -> CommandSpec: ...
def service_cmd(t: Target, action: str, *, enable: bool = False, force: bool = False) -> CommandSpec: ...
def config_set(t: Target, key: str, value: str) -> CommandSpec: ...
def serve(t: Target) -> CommandSpec: ...
```

### 5.2 Transport（只负责怎么执行）

```python
class Transport(Protocol):
    target: Target
    def run(self, spec: CommandSpec, cancel: CancelToken) -> CommandResult: ...
    def open_serve(self, spec: CommandSpec) -> ServeHandle: ...
    def verify(self, timeout: float = 20.0) -> None: ...
    def close(self) -> None: ...
```

> `CommandResult` 原样从 `cli.py` 搬到 `infra/process.py`，字段不变（`args/code/stdout/stderr/ok`）；旧 `cli.py` 只留到 C6。

- `LocalTransport`：`Popen` + 轮询超时/取消，保留 `CREATE_NO_WINDOW`。
- `SshTransport`：包现有 `SshSession`（握手、哨兵、here-doc 逻辑不动），`_ssh_lock` 收进内部。
- `info/login/logout` 的解析放在 `CliGateway` 一次实现，两个 Transport 都覆盖；Transport 只做转发。

### 5.3 CommandRunner（唯一允许起线程的地方）

- **串行 lane**：按 `Target.key` 一条队列、一个工作线程。登录后的 whoami / user list / backup list / 用户动作天然排队，删除 `pending_action`，也不会再出现 `backup` 与 `backup list` 并发开 SQLite。
- **代际**：每个 `TaskKey` 一个 generation，带 `target_key`；结果回到主线程后检查 generation、target、cancelled，否则静默丢弃。删除 `session_generation / info_generation / server_generation`。
- **回投**：30ms QTimer 排空 `MainThreadPump`，替代 `_post/inbox`；测试里直接 `pump.drain()`。
- **超时**：备份 1800s，其余 120s，`info/login/whoami` 20s，`kill` 5s；SSH 超时关通道返回 255。

### 5.4 错误归一化

```python
class ErrorKind(StrEnum):
    AUTH = "auth"
    FORBIDDEN = "forbidden"
    TRANSPORT = "transport"
    MISSING_BINARY = "missing_binary"
    USAGE = "usage"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    PARSE = "parse"
    UNKNOWN = "unknown"
```

映射：`3→AUTH`（清身份、唯一出口 `on_auth_expired`）；`4→FORBIDDEN`（toast + 后台刷新身份）；`127→MISSING_BINARY`；`255→TRANSPORT`（关通道、提示重连）；`2→USAGE`（版本不匹配，保留 details）；超时/取消/解析失败各一类；其余交给 `parsing.explain_failure`，无法识别时把原始输出放 details。**中文文案仍由 `parsing.py` 生成，契约不变。**

## 6. 控件与设计尺度

### 6.1 最小控件集（12 个）

| 控件 | 合并自 |
|---|---|
| `Surface(kind="card"｜"panel")` | Card、Panel |
| `Badge(kind="soft"｜"plain", dot=True)` | StatusPill、StatusBadge、GroupChip |
| `Button(kind, size)` | ActionButton、`button()` |
| `Field(kind="text"｜"select"｜"readonly")` | Field、SelectField、DisplayField |
| `Switch` + `SwitchRow` | 保留（唯一需要动画） |
| `Choice(kind="check"｜"row")` | CheckBox、ChoiceRow |
| `Avatar` / `ListRow` / `SectionHeading` / `Toast` / `Glyph` | UserRow、BackupRow 作为 `ListRow` 特化 |

删除：`Accent`、`VerticalRule`、`TextBox`（改 `QPlainTextEdit` + QSS）、`DisplayField`、`GroupChip`、`StatusPill`、`StatusBadge`。
`paintEvent` 从 21 降到 ≤9；tone→颜色只在 `ui/palette.py` 一个函数里。

### 6.2 tokens

| 类别 | 值 |
|---|---|
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 / 32 |
| 圆角 | 8 / 12 / 18 / 24 / 32；胶囊 = 高/2 |
| 字号 | 11 / 12 / 13 / 15 / 22（注意 `theme.font(n)` 实际渲染 `n+1` px） |
| 高度 | 24 / 28 / 32 / 36 / 40 / 60 |
| 最小宽 | 32 / 64 / 72 / 88 / 96 / 104 / 260 |

映射：24→24、28→28、30→32、34/36/38→36、40→40、58→60。**按钮不再收 `height` 参数**，只收 `size`；写不出魔法数字。

### 6.3 表单原语

```python
FormGrid.add(FormRow("备份地址", PathRow(...)), key="backup_dir")
FormRow.set_mode("edit" | "readonly" | "disabled")
CopyRow("安装命令", value=cmd)          # 复制后 1.5s 复位
```

`FormGrid` 标签列固定 112px，隐藏行不占位；只读用 `QLineEdit.setReadOnly(True)`（可选中复制），只有真正不可用才 disabled。`QGridLayout` 只允许出现在 `forms.py`。

### 6.4 对话框

| 现状 | 新形态 |
|---|---|
| SettingsDialog（448 行） | 删除，变设置页 |
| InstallServiceDialog（241 行） | `ServiceInstallSheet`：FormGrid + CopyRow |
| BackupDialog | 保留弹窗（列表抽 `DataList`） |
| Login / Account / Password | `FormDialog`（SheetDialog + FormGrid） |
| Confirm / Message | `SheetDialog` |

校验（密码 8–1024、两次一致、http(s)、远端绝对路径）移到 `domain/validation.py` 纯函数。

## 7. 流程编排

- **登录 + 待执行动作**：`登录点击 → LoginPrompt → LOGIN(blocking) → IDENTITY → USERS → BACKUPS → 原动作`，同一条 lane 顺序执行。"待执行"就是队列里的下一个任务，不要 `pending_action`。密码错保留对话框回填错误；`3` 回未登录；`255` 提示重连；非 Admin 提示无权限并清身份。
- **服务启停**：`SERVICE(start|stop|restart)` 成功后只 `invalidate(INFO)` + 重读 info，**不写任何乐观状态**（现有 8 处 `service_active=` 消失）。
- **前台会话**：`starting → open_serve → running(address,url) → 退出: None`；日志经 `parse_serve_event` 归约；远端停止先按 PID 发 `SIGTERM`，再兜底结束本地 ssh；`255` 提示"SSH 断开，常驻请装 systemd"。
- **安装/更新/卸载**：对话框只返回 `InstallOptions(scope, enable, start, force)`（纯值）→ 命令 → 重读 info → 可选 start/restart；系统级只生成复制命令，不执行。
- **备份/恢复**：`rules.backup_reason` 是唯一置灰理由；恢复成功后清空 `hosts/identity/users/backups/foreground`、重读 info、toast"请重新登录"。
- **切换目标**：`validate → 旧 target logout(5s，失败忽略) → 停旧前台 → 关旧 transport → invalidate 全部 → state.target=new → 存 config.gui.json → INFO`。任一步失败保留旧 target。
- **关闭窗口**：`phase=CLOSING → 停 pump → 有前台会话则确认并停止 → 当前 target 尽力 logout(5s) → close transports → accept`。CLOSING 后 runner 拒绝提交、不再弹窗。

### 7.1 并发与失败语义（与现状对齐）

- **内部后续任务排队，用户动作拒绝**：`login → identity → users → backups → 原动作` 走同一条 lane 依次执行；但用户在任一阻塞任务进行中再点别的，仍然只 toast `正在执行上一条命令`，不静默排队——否则"点两下执行两步"会变成新行为。
- **登录失败**：登录 sheet 不关闭，错误就地显示，用户名保留。现状是关闭后重新弹一个（`app.py:650-652`），验收时不要按"连续弹窗"写断言。
- **任何 `Target.key` 变化都要停旧前台**：包括同一台主机只换数据目录。现状只在 `target_changed`（连接/主机）时停，换数据目录会把旧 `serve` 留在旧目录继续占端口（`app.py:2800-2808`）。
- **备份成功立即刷新列表**：`BACKUP` 成功后 `invalidate(BACKUPS)` 并重读，不再像现状那样只改摘要、列表等下次打开才更新（`app.py:2463-2483`）。
- **远端 serve 的 loopback URL 不可打开**：日志里的 `url` 只显示成"远端监听 …"，不写成可点击地址；`page_url` 远端只认 Public URL。
- **`info` 失败保留上一份事实**：`HostConfig` 不清空，标 `info_state=error` 并在服务页显示"状态读取失败 · 重试"，不要停在"正在读取服务状态…"。

## 8. 模块布局

```text
gui/
  app.py                     # 仅 main()：QApplication、主题、bootstrap，约 40 行
  cdgui/
    __init__.py
    bootstrap.py             # load config → resolve Target → Transport → Store → Controller
    controller.py            # 流程编排；唯一调用 runner 的地方
    domain/
      target.py              # Endpoint、Target、Capability、resolve_target
      facts.py               # HostConfig、ServiceStatus、ForegroundSession
      state.py               # AppState、InflightEntry、LoginPrompt、Notice、assert_invariants
      reducers.py            # 全部 (AppState, Event) -> AppState 纯函数
      rules.py               # is_running / page_url / backup_reason / action_verdict
      validation.py          # 表单校验纯函数
      commands.py            # CommandSpec + 每个 CLI 动作的参数构造
    infra/
      process.py             # find_binary、run_popen
      transport.py           # Transport、LocalTransport、SshTransport
      ssh.py                 # SshSession（原 ssh_session.py 逻辑）
      gateway.py             # CliGateway：info/login/logout/whoami/users/backups/service
      runner.py              # CommandRunner、CancelToken、MainThreadPump
      serve.py               # ServeHandle + 原 ServerProcess
      errors.py              # CommandError、normalize
      persistence.py         # GuiConfigRepository（包 gui_config，原子保存）
    ui/
      main_window.py         # 窗口骨架、导航、顶栏、状态栏
      render.py              # project(state)->UiState；apply(UiState, Views)
      views.py               # Views 容器，只放控件引用
      pages/service.py accounts.py backups.py settings.py
      dialogs/base.py accounts.py service_install.py backup.py login.py
      primitives.py          # §6.1 的 12 个控件
      forms.py               # FormGrid / FormRow / PathRow / CopyRow
      tokens.py palette.py
  parsing.py gui_config.py server_config.py service_plan.py theme.py fonts.py
  assets/                    # 位置不变，app.py 里算 GUI_DIR
  tests/
```

**叶子模块保持原位**：`parsing.py`、`gui_config.py`、`server_config.py`、`service_plan.py`、`theme.py`、`fonts.py` 被 117 个测试锁住，是稳定契约层，不跟着搬；新架构收进 `cdgui/`。`widgets.py` 与 `dialogs.py` 在 C6/C7 被 `cdgui/ui/primitives.py` 和新对话框取代后删除。

PyInstaller：入口仍是 `gui/app.py`，`--paths gui` 能找到 `cdgui`；全部绝对静态 import，不用字符串入口、不用 `importlib`；`assets` 仍通过 `--add-data` 进 `_MEIPASS`，打包脚本与 `.app` 组装不改。

## 9. 迁移计划

分支 `refactor/gui-core`。不追求中间态可运行，用两条硬规则防死代码：

- **(a) C1–C5 只新增**，旧 `app.py` 一行不改，也不 import 新模块——不存在两套实现同时生效；
- **(b) C6 同时完成"切换 + 删除"**，旧代码不许以"备用"名义留下。C3 的 `cli.py` / `ssh_session.py` 只允许 5 行转发壳，C6 必删。

| 提交 | 新增 | 删除 | 门禁 |
|---|---|---|---|
| C1 基线 | `tests/test_contract_gui.py` 锁住现有 117 个测试与 `parsing` 契约 | — | 117 通过 |
| C2 领域层 | `cdgui/domain/*` + 纯函数测试（含不变量） | — | 新旧测试全绿 |
| C3 基础设施 | `cdgui/infra/*`；`ssh_session.py` 逻辑迁 `infra/ssh.py`，旧名留转发壳 | — | `go test` 不受影响 |
| C4 编排层 | `cdgui/controller.py` + `FakeTransport` 状态机测试 | — | 任务顺序、迟到结果断言通过 |
| C5 视图层 | `cdgui/ui/*`、四页、新对话框、render、primitives | — | offscreen 页面测试通过 |
| C6 切换 | `app.py` 改 40 行 main + `bootstrap.py` | 旧 `MainWindow`（2922 行）、`dialogs.py` 旧体、`cli.py`、`ssh_session.py` 转发壳；`test_settings_dialog.py` 改为页面测试 | `grep -rn "_update_buttons\|self\.remote\|pending_action\|service_active =" gui/` 为 0 |
| C7 收尾 | 更新 README / AGENTS / gui README；把 `BEHAVIOR_BASELINE.md` 标成验收基线 | `widgets.py` 中只服务旧布局的类；复制按钮的旧实现 | 全量测试 + 无头冒烟 + 明暗截图 |

C6 之后 `gui/app.py` 只做四件事：设 `QT_QPA_PLATFORM` 之外的启动策略、装主题、建 `MainWindow`、`app.exec()`。

## 10. 测试与门禁

| 层 | 内容 |
|---|---|
| 纯函数 | `rules` 表驱动：状态矩阵 × 全部 `ActionId`，缺 `Verdict` 直接失败；`commands` golden argv；`reducers` 每个事件断言前后不变量；`parsing/config/service_plan` 原 112 个用例原样保留 |
| Controller | 真实 `Store` + `FakeTransport` + 手动 `pump.drain()`：登录顺序、切目标后迟到结果不落地、关闭后无回调 |
| 页面 | offscreen 构造页面 + fixture 状态，断言可见性/文本/`isEnabled`；保留 1 个 900×740 几何 smoke |
| 静态守卫 | `tests/test_architecture.py` 用 `ast`：`ui/` 不出现 `height=<int>`、`setFixedHeight(<int>)`、`theme.font(<int>)`；`QGridLayout` 只在 `forms.py`；`threading.Thread` 只在 `infra/runner.py|serve.py|ssh.py`；`service_active`、`is_owner` 只允许在 `domain/rules.py`；`paintEvent` ≤10 |

验收命令：

```sh
cd gui
.venv/bin/python -m compileall -q .
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m unittest tests.test_architecture -v
```

截图：结构断言是必过门禁；像素基线只做 Linux 手动/nightly（CJK 字体、DPI、Qt 补丁版本跨机不稳），固定 `QT_SCALE_FACTOR=1`、`QT_FONT_DPI=96`、关动画、冻结时间文案，通道差 >8 的像素占比 >0.3% 才失败，不引依赖。

## 11. 风险与取舍

1. **C6 是单点大提交**：切换当刻必然全红。缓解：C1–C5 的测试先按新接口写好，C6 只做装配；C6 不合并前不推送。
2. **SSH + 线程 + 弹窗难测**：用 `FakeTransport` 和 `pump.drain()` 把时序变成同步；SSH 只在 `infra/ssh.py` 保留，靠现有 14 个 fake-ssh 测试继续守。
3. **PyInstaller 漏包**：新增包全部静态 import 且从 `app.py → bootstrap → controller` 可达；C6 后本地跑一次 `pyinstaller --onefile` 冒烟。
4. **页面保活带来的内存与脏状态**：四页都是轻量控件，可接受；`dirty` 标记避免后台页重排。
5. **设计尺度收敛会改观感**：按钮高度 30/34/38 归到 32/36，复制按钮 38→36，需要明暗两套截图核对，允许 ±2px 差异。
6. **不做的事**：不改 Go、不改 CLI 输出契约、不加新功能（日志面板只展示现有 40 行 tail）、不做 i18n、不做移动端。

## 12. 验收清单

完整基线见 [`BEHAVIOR_BASELINE.md`](BEHAVIOR_BASELINE.md)：全局机制、argv 表、入口映射、服务/登录/备份状态矩阵、远端差异、关闭顺序、20 条跨流程约束、12 处待修不一致、测试缺口。

重构后的验收顺序：

1. `117 + 新增` 全部通过（纯逻辑 / controller / 页面 / 架构守卫）。
2. 按 `BEHAVIOR_BASELINE.md` §4–§6 逐状态断言按钮可见性、启用态、文案、tooltip 属性。
3. 按 §2 的 argv 表断言命令拼装与 stdin（密码只在 stdin）。
4. 按 §7 核对关闭顺序与超时；systemd 运行中关窗不停止服务。
5. 按 §8 确认 12 处修复生效，其余行为不回退。
6. 900×740 与 1000×760、明暗两套、本机/远端两种连接的截图核对。

## 13. 已拍板（2026-11-26）

1. 设置页接受"两张卡各自保存、没有全局保存"——把"改连接"和"改服务端配置"两种语义分开。
2. 备份页的"停止服务"按钮**需要单独二次确认**（恢复前的确认仍然保留）。
3. 导航徽标未登录时显示 `—`，不隐藏。
4. `BEHAVIOR_BASELINE.md` §8 的 12 处不一致**全部修掉**；没有用户依赖，不背兼容包袱，以代码自洽为准。
