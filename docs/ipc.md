# 本地控制面 IPC（v1）

> 面向桌面 GUI、Android 外壳和自动化 agent 的本机机器接口。
> 传输是 stdio + NDJSON，信封是 JSON-RPC 2.0 形状；stdout 只有协议行，日志只写 stderr。
>
> 边界一句话：**`ipc` 是本地控制面（服务启停、备份、日志、配置投影），只给 GUI/外壳用；
> `/api/v1` 是浏览器数据面（账户、会话、消息、附件、设置），两者不混用。**

## 1. 为什么需要它

桌面 GUI 早期通过拼接 CLI 参数、解析中文输出（`gui/parsing.py`）来获取服务状态、配置和备份列表。这条路径脆弱：

- 中文文案、表格列宽、退出码一变，GUI 就要同步改解析器；
- 只能拿到「给人看」的文本，拿不到稳定的字段类型；
- Android 等新外壳无法直接复用 Python 解析层。

`ipc` 把同一批事实变成结构化 JSON：字段名、类型、错误码固定，GUI 不再解析文本，Android/脚本也可以复用同一契约。
v1 在只读投影之外增加了受控写方法（备份、服务启停、日志跟随），但**不替代 HTTP 数据面**，也不承载聊天内容。

## 2. 传输与信封

启动：

```sh
chat-deepseek ipc [--data-dir <dir>]
```

- `--data-dir` 与其它子命令一致：显式参数 > `CHAT_DEEPSEEK_DATA_DIR` > 二进制同级的 `data/`。
- 传输为 **stdio**，一行一个 JSON 文档（NDJSON）；进程不监听端口。
- 空行会被忽略，不产生响应；单行上限 **1 MiB**（含换行），超长行返回 `bad_request` 后继续服务。
- stdin EOF 是正常关闭：处理完在途请求后以退出码 **0** 结束。
- 进程退出码：`0` 正常（含 EOF）、`1` 运行错误、`2` 用法错误；`chat-deepseek ipc --help` 只写 stderr，退出码 `0`。
- stdout 只写协议行；任何日志、错误说明都写 stderr。
- 每个请求并发处理。响应可能按完成顺序返回，**客户端必须按 `id` 匹配**；每一行都是完整、加锁、立即 flush 的 JSON。
- 写方法两两之间串行（`service.*` 一把容量 1 的信号量、`backup.*` 一把互斥锁），但**并发发出的两个写请求，谁先执行不保证**：
  先发的 `backup.delete` 可能后到的 `backup.restore` 之前跑完。所以客户端必须「等一个写请求的响应，再发下一个」，
  不要把写操作当队列一次性堆进管道。并发冲突时返回 `unavailable`（服务操作）或按资源状态报错（备份）。
- 事件（无 `id` 的 `event.*` 通知）和响应共用同一把 stdout 锁，不会出现半行交错；事件只在 `service.start`/`service.restart` 成功后或 `service.logs` 发现服务正在运行时开始。

请求：

```json
{"jsonrpc":"2.0","id":1,"method":"system.status","params":{}}
```

成功响应：

```json
{"jsonrpc":"2.0","id":1,"result":{}}
```

错误响应：

```json
{"jsonrpc":"2.0","id":1,"error":{"code":"not_found","message":"未知方法 \"foo\""}}
```

事件通知（服务端主动推送，没有 `id`）：

```json
{"jsonrpc":"2.0","method":"event.service.log","params":{"line":"...","stream":"stdout"}}
```

约定：

- `jsonrpc` 必须是字符串 `"2.0"`，否则 `bad_request`；`method` 必须是非空字符串。
- `id` 原样回显，支持数字或字符串；缺失 `id` 的合法请求按 JSON-RPC notification 处理：执行但不返回响应。
- 无法解析的 JSON 会返回 `bad_request`，此时 `id` 为 `null`，服务不退出。
- 只读方法忽略 `params`；写方法只解析自己声明的字段，未知字段一律忽略，便于向前兼容。
- 未知方法（包括客户端误发 `event.*`）返回 `not_found`。

## 3. 错误码

错误码是字符串；调用方按字符串匹配，不要按数字。括号内是对齐的 CLI 退出码语义。

| code | 含义 | CLI 退出码 | 本版是否出现 |
| --- | --- | --- | --- |
| `bad_request` | JSON 坏、信封字段非法、请求行超长、写方法参数非法或路径穿越 | 2 | 是 |
| `internal` | 读配置/读备份目录/读写文件等本机内部错误 | 1 | 是 |
| `unauthenticated` | 未登录或登录过期 | 3 | 否（预留给后续版本） |
| `permission_denied` | 已登录但权限不足 | 4 | 否（预留给后续版本） |
| `not_found` | 方法不存在；备份文件不存在 | — | 是 |
| `unavailable` | 依赖的服务/能力不可用：服务运行中不能备份、systemd/journalctl 不可用、服务操作并发冲突 | — | 是 |

错误对象只有 `code`、`message` 两个字段；`message` 用于诊断，不保证稳定，**不要解析它做逻辑判断**。
`message` 使用中文，尽量与 CLI 文案一致；例如服务运行中备份固定为「服务运行中，备份已暂停」。

## 4. 方法

### 4.1 `system.status`

探测配置里的监听地址，返回版本、数据目录和服务状态。不需要参数，不读数据库、不写文件。

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `version` | string | 否 | 构建版本，如 `0.1.4-official0.1.4` |
| `dataDir` | string | 否 | 数据目录绝对路径 |
| `service` | object | 否 | 服务探测结果 |
| `service.state` | `"running"` \| `"stopped"` \| `"unknown"` | 否 | 见下 |
| `service.listen` | string | 否 | `config.json` 里的监听地址（未改动） |
| `service.source` | `"probe"` | 否 | 状态来源；固定为 TCP 探测 |

`state` 语义：

- `running`：300ms 内 TCP 连接配置的监听地址成功；
- `stopped`：地址可解析，但连接失败（拒绝、超时、不可达）；
- `unknown`：探测本身无法进行（监听地址格式非法、DNS 解析失败等）；不会凭 PID 或 systemd 猜测。

通配地址会探测回环：`0.0.0.0` → `127.0.0.1`，`::` → `::1`，空主机名 → `127.0.0.1`。

示例：

```json
{"jsonrpc":"2.0","id":1,"result":{"version":"0.1.4-official0.1.4","dataDir":"/home/<user>/chat-deepseek/data","service":{"state":"running","listen":"127.0.0.1:8091","source":"probe"}}}
```

### 4.2 `system.capabilities`

客户端启动时应先调用它，确认协议版本和可用方法。

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `platform` | string | 否 | Go 的 `runtime.GOOS`：`linux`、`windows`、`darwin` |
| `methods` | string[] | 否 | 实际注册的方法名，顺序稳定；由 `internal/ipc` 方法表生成 |
| `features` | object | 否 | 能力开关 |
| `features.systemd` | bool | 否 | 本阶段固定 `false`（不表示 `service.*` 方法不存在） |
| `features.ssh` | bool | 否 | 本阶段固定 `false` |
| `features.autostart` | bool | 否 | 本阶段固定 `false` |
| `features.backup` | bool | 否 | 固定 `true`：`backup.create/restore/delete` 可用 |
| `features.service` | bool | 否 | 固定 `true`：`service.*` 已注册；底层 systemd 不可用时返回 `unavailable` |
| `ipcVersion` | number | 否 | 控制面契约版本；本版为 `1` |

`methods` 与注册表同源，不会出现「声明了但调不通」或反之。本版方法：

```text
system.status
system.capabilities
config.get
backup.list
backup.create
backup.restore
backup.delete
service.start
service.stop
service.restart
service.logs
```

示例：

```json
{"jsonrpc":"2.0","id":2,"result":{"platform":"linux","methods":["system.status","system.capabilities","config.get","backup.list","backup.create","backup.restore","backup.delete","service.start","service.stop","service.restart","service.logs"],"features":{"systemd":false,"ssh":false,"autostart":false,"backup":true,"service":true},"ipcVersion":1}}
```

### 4.3 `config.get`

现有 `config.json` 的只读投影，外加数据目录与版本。**不返回任何密钥、密码或 Cookie**，也不返回 `public_url`。

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `dataDir` | string | 否 | 数据目录绝对路径 |
| `listen` | string | 否 | HTTP 服务监听地址；缺省为 `127.0.0.1:8090` |
| `apiOrigin` | string | 否 | DeepSeek API 源地址；缺省为 `https://api.deepseek.com` |
| `backupDir` | string | 否 | 备份目录绝对路径；未配置时为 `<dataDir>/backups` |
| `version` | string | 否 | 构建版本 |

示例：

```json
{"jsonrpc":"2.0","id":3,"result":{"dataDir":"/home/<user>/chat-deepseek/data","listen":"127.0.0.1:8091","apiOrigin":"https://api.deepseek.com","backupDir":"/home/<user>/chat-deepseek/data/backups","version":"0.1.4-official0.1.4"}}
```

### 4.4 `backup.list`

列出备份目录里的归档，数据与 `chat-deepseek backup list` 同源（复用 `internal/backup.List`）。

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `backups` | object[] | 否 | 目录不存在或没有归档时为 `[]`，不是 `null` |
| `backups[].file` | string | 否 | 文件名 |
| `backups[].path` | string | 否 | 绝对路径 |
| `backups[].size` | number | 否 | 字节数 |
| `backups[].mtime` | string | 否 | 归档时间，RFC 3339（带本地时区偏移） |
| `dir` | string | 否 | 备份目录绝对路径 |

`internal/backup.List` 只识别普通文件形式的 `.zip`（CLI 的实际产物）。目录不存在属于正常情况，返回空数组而不是错误。

示例：

```json
{"jsonrpc":"2.0","id":4,"result":{"backups":[{"file":"chat-deepseek-20261126-021400.zip","path":"/home/<user>/chat-deepseek/data/backups/chat-deepseek-20261126-021400.zip","size":50529024,"mtime":"2026-11-26T02:14:00+08:00"}],"dir":"/home/<user>/chat-deepseek/data/backups"}}
```

### 4.5 `backup.create`

把数据目录打包成 ZIP，复用 `internal/backup.Create`。不需要参数。

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `file` | string | 否 | 归档文件名，`chat-deepseek-YYYYMMDD-HHMMSS.zip` |
| `path` | string | 否 | 归档绝对路径 |
| `size` | number | 否 | 字节数 |

前置条件与 CLI 相同：

- 数据目录里必须有 `chat.db`，否则 `not_found`；
- 服务正在运行（TCP 探测为 `running`），或存在 `chat.db-wal`/`chat.db-shm`，返回
  `{"error":{"code":"unavailable","message":"服务运行中，备份已暂停"}}`；
- 备份目录按 `--backup-dir` 的等价规则解析：`config.json` 的 `backup_dir` > `<dataDir>/backups`。

成功示例：

```json
{"jsonrpc":"2.0","id":5,"result":{"file":"chat-deepseek-20261127-012500.zip","path":"/home/<user>/chat-deepseek/data/backups/chat-deepseek-20261127-012500.zip","size":50529024}}
```

服务运行中示例：

```json
{"jsonrpc":"2.0","id":5,"error":{"code":"unavailable","message":"服务运行中，备份已暂停"}}
```

### 4.6 `backup.restore`

用备份覆盖 `config.json`、`chat.db`、`master.key` 和 `files/`，复用 `internal/backup.Restore`。

参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | 是 | 备份目录内的 `.zip` 文件名，不能带路径 |

结果：

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `ok` | bool | 否 | 成功固定 `true` |
| `restored` | string[] | 否 | 归档里实际恢复的数据条目，如 `["chat.db","config.json","files/..."]` |

前置条件与 CLI 相同：服务运行中或存在 `chat.db-wal`/`chat.db-shm` 时返回
`{"error":{"code":"unavailable","message":"服务运行中，恢复已暂停"}}`，不会绕过 WAL 检查。

`file` 必须是**备份目录内的普通 `.zip` 文件名**：含 `/`、`\`、绝对路径、`..`、符号链接或空字节一律
`bad_request`；不存在为 `not_found`；不是合法 ZIP、包含非法归档路径或没有 `chat.db` 为 `bad_request`。

成功示例：

```json
{"jsonrpc":"2.0","id":6,"result":{"ok":true,"restored":["chat.db","config.json"]}}
```

### 4.7 `backup.delete`

删除备份目录内的一个归档。参数同 `backup.restore` 的 `file`，结果固定 `{"ok":true}`。

校验规则与 `backup.restore` 相同：只接受备份目录内的普通 `.zip` 文件名，路径穿越和符号链接返回
`bad_request`；文件不存在返回 `not_found`。删除单个备份不会修改数据目录，因此不要求服务停止。

示例：

```json
{"jsonrpc":"2.0","id":7,"result":{"ok":true}}
```

### 4.8 `service.start`

启动已安装的服务。复用 `internal/service` 的 systemd 逻辑（用户级 `systemctl --user`），
不另写进程管理；本版不支持 `--system`/`--foreground` 参数。

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `state` | `"running"` \| `"starting"` | 否 | 启动后 TCP 探测通过为 `running`，否则 `starting` |
| `pid` | number | 否 | systemd 的 `MainPID`；查不到时为 `0` |
| `listen` | string | 否 | `config.json` 里的监听地址 |

- 启动/停止/重启同一时刻只允许一个在途操作。第二个并发请求立即返回
  `{"error":{"code":"unavailable","message":"服务操作正在进行，请稍候"}}`，避免双击按钮起两个进程。
- 平台不支持 systemd、unit 未安装或 `systemctl` 失败时返回 `unavailable`，`message` 为底层中文错误。
- 成功后自动开始 `event.service.log` 跟随（见 §5）。

示例：

```json
{"jsonrpc":"2.0","id":8,"result":{"state":"running","pid":12345,"listen":"127.0.0.1:8091"}}
```

### 4.9 `service.stop`

停止服务。成功返回 `{"state":"stopped"}`；失败语义同 `service.start`，返回 `unavailable`。

示例：

```json
{"jsonrpc":"2.0","id":9,"result":{"state":"stopped"}}
```

### 4.10 `service.restart`

重启服务。字段与 `service.start` 相同；成功后重新开始日志跟随。

示例：

```json
{"jsonrpc":"2.0","id":10,"result":{"state":"starting","pid":12346,"listen":"127.0.0.1:8091"}}
```

### 4.11 `service.logs`

读取服务最近 N 行日志。日志源是 systemd 用户单元的 journal（`journalctl --user -u chat-deepseek.service`），
因为 `serve` 本身只写 stderr、不落日志文件。

参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tail` | number | 否 | 读取行数，默认 `200`，必须是正整数；超过 `5000` 按 `5000` 读取并返回 `truncated:true` |

结果：

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `lines` | string[] | 否 | 最近的日志行，从旧到新；没有日志时为 `[]` 不是 `null` |
| `truncated` | bool | 否 | `tail` 超过 `5000` 被截断时为 `true`，否则 `false` |

- `journalctl` 不可用（非 Linux、未安装、无法连接用户 journal）时返回 `unavailable`，不会伪造空日志。
- 如果探测到服务正在运行，本方法会顺带开启 `event.service.log` 跟随；`service.start`/`service.restart`
  成功后也会开启。停止服务或 IPC 退出时跟随自动结束。
- 读取是快照；实时追加走事件，不要轮询 `service.logs` 做 tail。

示例：

```json
{"jsonrpc":"2.0","id":11,"result":{"lines":["chat-deepseek 正在监听 127.0.0.1:8091","... "],"truncated":false}}
```

## 5. 事件

当前只有一种事件：

```json
{"jsonrpc":"2.0","method":"event.service.log","params":{"line":"...","stream":"stdout"}}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `method` | string | 固定 `event.service.log` |
| `params.line` | string | 一行日志；可能包含换行，JSON 中会转义 |
| `params.stream` | `"stdout"` \| `"stderr"` | 日志流。journal 记录里能识别 `_STREAM_ID=stderr` 时为 `stderr`，否则按 `stdout` 处理 |

- 事件没有 `id`；客户端按 `method` 分发，不要和请求响应混在同一个 `id` 匹配表里。
- 事件和响应共用 stdout 锁并逐行 flush，保证不会出现半行交错。
- 事件可能出现在任意两条响应之间（包括触发它的方法响应之前）；客户端按 `id` 匹配响应、按 `method` 分发事件，不要假设先后。
- 事件只在服务启动成功、或 `service.logs` 发现服务运行中时开启；跟随的是 journal 的追加内容。
- 事件是尽力而为的观测通道：journal 不可用只会写 stderr，不会让启动请求失败。
- 停止服务、重启服务、stdin EOF 或进程退出都会停止跟随。

## 6. 版本号策略

- `system.capabilities.ipcVersion` 是控制面契约版本，本版为整数 `1`。
- **向后兼容的增量**（新增方法、新增字段、新增错误码）不升 `ipcVersion`；客户端必须忽略不认识的字段/方法。
- **破坏性变更**（删除/重命名方法或字段、改变字段含义、改变错误码语义）升主版本。
- 客户端应先调用 `system.capabilities`：若 `ipcVersion > 1`，提示升级外壳或降级使用。
- `version` 是产品版本（构建期注入），与 `ipcVersion` 独立；不要用产品版本判断协议能力。

## 7. 手工调试

在仓库根目录构建并喂几行请求（stdout 是协议，stderr 另存）：

```sh
go build -o /tmp/chat-deepseek ./cmd/chat-deepseek

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"system.capabilities","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"system.status","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"config.get","params":{}}' \
  '{"jsonrpc":"2.0","id":4,"method":"backup.list","params":{}}' \
  '{"jsonrpc":"2.0","id":5,"method":"service.logs","params":{"tail":20}}' \
  | /tmp/chat-deepseek ipc --data-dir ./data 2>/tmp/ipc.log
```

备份写方法（先停服务）：

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"backup.create","params":{}}' \
  | /tmp/chat-deepseek ipc --data-dir ./data 2>/tmp/ipc.log
```

恢复和删除需要把 `file` 换成 `backup.list` 返回的文件名：

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"backup.restore","params":{"file":"chat-deepseek-20261127-012500.zip"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"backup.delete","params":{"file":"chat-deepseek-20261127-012500.zip"}}' \
  | /tmp/chat-deepseek ipc --data-dir ./data 2>/tmp/ipc.log
```

只想看某个字段可以接 `jq`：

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"system.status","params":{}}' \
  | /tmp/chat-deepseek ipc --data-dir ./data 2>/dev/null \
  | jq -r '.result.service.state'
```

手工验证错误路径：

```sh
printf '%s\n' \
  'not json' \
  '{"jsonrpc":"2.0","id":2,"method":"no.such.method","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"backup.delete","params":{"file":"../chat.db"}}' \
  | /tmp/chat-deepseek ipc --data-dir ./data
# 应先后得到 bad_request（id=null）、not_found（id=2）和 bad_request（id=3），进程不退出
```

`Ctrl-D`（stdin EOF）后进程以 0 退出。GUI 可以常驻一个 `ipc` 子进程，按请求写一行、按 `id` 读响应，
同时监听没有 `id` 的事件行。

## 8. 与 `/api/v1` 的分工

| | `ipc`（本地控制面） | `/api/v1`（数据面） |
| --- | --- | --- |
| 传输 | 本机 stdio，NDJSON | HTTP/JSON + SSE |
| 使用者 | 桌面 GUI、Android 外壳、本机脚本/agent | 浏览器 Web 客户端 |
| 身份 | 继承启动它的操作系统用户；无登录 | Cookie 会话 + 内存 CSRF |
| 能力 | 状态、能力、配置投影、备份、服务启停与日志 | 账户、会话、消息、附件、设置、Key |
| 网络暴露 | 不监听端口 | 按 `listen`/反代暴露 |
| 错误 | 字符串错误码 | HTTP 状态码 + JSON 错误 |

边界：

- **ipc = 本地控制面 + GUI；HTTP = 浏览器数据面；两者不混用。** GUI 不拼 CLI、不解析中文，也不通过 HTTP 调管理操作。
- `ipc` 会写备份目录、恢复数据目录、调用 systemd，但**不写聊天数据、不传密钥/密码/聊天内容**；它不是第二个业务 API。
- 浏览器仍只走 `/api/v1`；`ipc` 不引入新的前端可用接口。
- 需要新增写能力时先加方法并同步本文档；新增方法属于向后兼容增量，不升 `ipcVersion`。

## 9. 已知限制（诚实清单）

- `service.*` 底层只有现有 `internal/service` 的 systemd 用户级实现；Windows/macOS、没有 systemd 的
  Linux 或未安装 unit 都会返回 `unavailable`，不会退化成「在 IPC 里另起一个前台进程」。
- `pid` 来自 `systemctl show MainPID`；拿不到时是 `0`，客户端应按 0 表示未知。
- `service.logs` 依赖 `journalctl`。本版不读取额外日志文件，也不会把 CLI 前台输出接进事件流。
- journal 通常无法可靠区分 stdout/stderr，`params.stream` 可能统一为 `stdout`；字段保留是为了以后换日志源。
- `truncated` 只在 `tail` 超过 `5000` 被截断时为 `true`；只返回请求的最近 N 行，不额外统计总行数。
- `backup.restore` 成功返回的是归档里恢复到数据目录的条目名，不是恢复前的文件内容或校验和。
- 不校验 `backup.restore` 归档与当前产品版本的兼容性，和 CLI 行为一致。
