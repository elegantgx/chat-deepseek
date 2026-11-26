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
v1 在只读投影之外增加了受控写方法：备份、服务启停/安装、日志跟随、配置写入，以及本机管理面的认证与账户管理。
认证使用与 CLI 同款的会话文件（归属当前 ipc 进程），但**不替代 HTTP 数据面**，也不承载聊天内容。

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
- 写方法两两之间串行：`service.*` 共用一把容量 1 的信号量，`backup.*` 共用一把互斥锁，
  `auth.*`/`account.*` 共用一把互斥锁，`config.set` 单独串行化读-改-写。但**并发发出的两个写请求，谁先执行不保证**：
  先发的 `backup.delete` 可能后到的 `backup.restore` 之前跑完。所以客户端必须「等一个写请求的响应，再发下一个」，
  不要把写操作当队列一次性堆进管道。并发冲突时返回 `unavailable`（服务操作）或按资源状态报错（备份、账户）。
- 事件（无 `id` 的 `event.*` 通知）和响应共用同一把 stdout 锁，不会出现半行交错；事件只在 `service.start`/`service.restart` 成功后或 `service.logs` 发现服务正在运行时开始。

请求：

```json
{ "jsonrpc": "2.0", "id": 1, "method": "system.status", "params": {} }
```

成功响应：

```json
{ "jsonrpc": "2.0", "id": 1, "result": {} }
```

错误响应：

```json
{ "jsonrpc": "2.0", "id": 1, "error": { "code": "not_found", "message": "未知方法 \"foo\"" } }
```

事件通知（服务端主动推送，没有 `id`）：

```json
{ "jsonrpc": "2.0", "method": "event.service.log", "params": { "line": "...", "stream": "stdout" } }
```

约定：

- `jsonrpc` 必须是字符串 `"2.0"`，否则 `bad_request`；`method` 必须是非空字符串。
- `id` 原样回显，支持数字或字符串；缺失 `id` 的合法请求按 JSON-RPC notification 处理：执行但不返回响应。
- 无法解析的 JSON 会返回 `bad_request`，此时 `id` 为 `null`，服务不退出。
- 只读方法忽略 `params`；写方法只解析自己声明的字段，未知字段一律忽略，便于向前兼容。
- 未知方法（包括客户端误发 `event.*`）返回 `not_found`。

## 3. 错误码

错误码是字符串；调用方按字符串匹配，不要按数字。括号内是对齐的 CLI 退出码语义。

| code                | 含义                                                                                                 | CLI 退出码 | 本版是否出现 |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `bad_request`       | JSON 坏、信封字段非法、请求行超长、写方法参数非法或路径穿越                                          | 2          | 是           |
| `internal`          | 读配置/读备份目录/读写文件/读写数据库等本机内部错误                                                  | 1          | 是           |
| `unauthenticated`   | 未登录、登录过期，或 `auth.login` 的凭据错误                                                         | 3          | 是           |
| `permission_denied` | 已登录但权限不足（账户操作、组管理）                                                                 | 4          | 是           |
| `not_found`         | 方法不存在；备份文件不存在；账户不存在                                                               | —          | 是           |
| `conflict`          | 资源冲突：用户名已被占用                                                                             | 1          | 是           |
| `unavailable`       | 依赖的服务/能力不可用：服务运行中不能备份、systemd/journalctl 不可用、服务操作并发冲突、服务未初始化 | —          | 是           |

错误对象只有 `code`、`message` 两个字段；`message` 用于诊断，不保证稳定，**不要解析它做逻辑判断**。
`message` 使用中文，尽量与 CLI 文案一致；例如服务运行中备份固定为「服务运行中，备份已暂停」。

## 4. 方法

### 4.1 `system.status`

探测配置里的监听地址，返回版本、数据目录和服务状态。不需要参数，不读数据库、不写文件。

| 字段             | 类型                                      | 可空 | 说明                                 |
| ---------------- | ----------------------------------------- | ---- | ------------------------------------ |
| `version`        | string                                    | 否   | 构建版本，如 `0.1.4-official0.1.4`   |
| `dataDir`        | string                                    | 否   | 数据目录绝对路径                     |
| `service`        | object                                    | 否   | 服务探测结果                         |
| `service.state`  | `"running"` \| `"stopped"` \| `"unknown"` | 否   | 见下                                 |
| `service.listen` | string                                    | 否   | `config.json` 里的监听地址（未改动） |
| `service.source` | `"probe"`                                 | 否   | 状态来源；固定为 TCP 探测            |

`state` 语义：

- `running`：300ms 内 TCP 连接配置的监听地址成功；
- `stopped`：地址可解析，但连接失败（拒绝、超时、不可达）；
- `unknown`：探测本身无法进行（监听地址格式非法、DNS 解析失败等）；不会凭 PID 或 systemd 猜测。

通配地址会探测回环：`0.0.0.0` → `127.0.0.1`，`::` → `::1`，空主机名 → `127.0.0.1`。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "version": "0.1.4-official0.1.4",
    "dataDir": "/home/<user>/chat-deepseek/data",
    "service": { "state": "running", "listen": "127.0.0.1:8091", "source": "probe" }
  }
}
```

### 4.2 `system.capabilities`

客户端启动时应先调用它，确认协议版本和可用方法。

| 字段                 | 类型     | 可空 | 说明                                                                     |
| -------------------- | -------- | ---- | ------------------------------------------------------------------------ |
| `platform`           | string   | 否   | Go 的 `runtime.GOOS`：`linux`、`windows`、`darwin`                       |
| `methods`            | string[] | 否   | 实际注册的方法名，顺序稳定；由 `internal/ipc` 方法表生成                 |
| `features`           | object   | 否   | 能力开关                                                                 |
| `features.systemd`   | bool     | 否   | 本阶段固定 `false`（不表示 `service.*` 方法不存在）                      |
| `features.ssh`       | bool     | 否   | 本阶段固定 `false`                                                       |
| `features.autostart` | bool     | 否   | 本阶段固定 `false`                                                       |
| `features.backup`    | bool     | 否   | 固定 `true`：`backup.create/restore/delete` 可用                         |
| `features.service`   | bool     | 否   | 固定 `true`：`service.*` 已注册；底层 systemd 不可用时返回 `unavailable` |
| `ipcVersion`         | number   | 否   | 控制面契约版本；本版为 `1`                                               |

`features` 不新增认证/账户开关：对应方法始终注册，调用时按会话与权限返回结构化错误。

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
auth.whoami
auth.login
auth.logout
account.list
account.add
account.password
account.delete
config.set
service.install
service.uninstall
```

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "platform": "linux",
    "methods": [
      "system.status",
      "system.capabilities",
      "config.get",
      "backup.list",
      "backup.create",
      "backup.restore",
      "backup.delete",
      "service.start",
      "service.stop",
      "service.restart",
      "service.logs",
      "auth.whoami",
      "auth.login",
      "auth.logout",
      "account.list",
      "account.add",
      "account.password",
      "account.delete",
      "config.set",
      "service.install",
      "service.uninstall"
    ],
    "features": {
      "systemd": false,
      "ssh": false,
      "autostart": false,
      "backup": true,
      "service": true
    },
    "ipcVersion": 1
  }
}
```

### 4.3 `config.get`

现有 `config.json` 的只读投影，外加数据目录与版本。**不返回任何密钥、密码或 Cookie**，也不返回 `public_url`。

| 字段        | 类型   | 可空 | 说明                                                   |
| ----------- | ------ | ---- | ------------------------------------------------------ |
| `dataDir`   | string | 否   | 数据目录绝对路径                                       |
| `listen`    | string | 否   | HTTP 服务监听地址；缺省为 `127.0.0.1:8090`             |
| `apiOrigin` | string | 否   | DeepSeek API 源地址；缺省为 `https://api.deepseek.com` |
| `backupDir` | string | 否   | 备份目录绝对路径；未配置时为 `<dataDir>/backups`       |
| `version`   | string | 否   | 构建版本                                               |

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "dataDir": "/home/<user>/chat-deepseek/data",
    "listen": "127.0.0.1:8091",
    "apiOrigin": "https://api.deepseek.com",
    "backupDir": "/home/<user>/chat-deepseek/data/backups",
    "version": "0.1.4-official0.1.4"
  }
}
```

### 4.4 `backup.list`

列出备份目录里的归档，数据与 `chat-deepseek backup list` 同源（复用 `internal/backup.List`）。

| 字段              | 类型     | 可空 | 说明                                       |
| ----------------- | -------- | ---- | ------------------------------------------ |
| `backups`         | object[] | 否   | 目录不存在或没有归档时为 `[]`，不是 `null` |
| `backups[].file`  | string   | 否   | 文件名                                     |
| `backups[].path`  | string   | 否   | 绝对路径                                   |
| `backups[].size`  | number   | 否   | 字节数                                     |
| `backups[].mtime` | string   | 否   | 归档时间，RFC 3339（带本地时区偏移）       |
| `dir`             | string   | 否   | 备份目录绝对路径                           |

`internal/backup.List` 只识别普通文件形式的 `.zip`（CLI 的实际产物）。目录不存在属于正常情况，返回空数组而不是错误。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "backups": [
      {
        "file": "chat-deepseek-20261126-021400.zip",
        "path": "/home/<user>/chat-deepseek/data/backups/chat-deepseek-20261126-021400.zip",
        "size": 50529024,
        "mtime": "2026-11-26T02:14:00+08:00"
      }
    ],
    "dir": "/home/<user>/chat-deepseek/data/backups"
  }
}
```

### 4.5 `backup.create`

把数据目录打包成 ZIP，复用 `internal/backup.Create`。不需要参数。

| 字段   | 类型   | 可空 | 说明                                            |
| ------ | ------ | ---- | ----------------------------------------------- |
| `file` | string | 否   | 归档文件名，`chat-deepseek-YYYYMMDD-HHMMSS.zip` |
| `path` | string | 否   | 归档绝对路径                                    |
| `size` | number | 否   | 字节数                                          |

前置条件与 CLI 相同：

- 数据目录里必须有 `chat.db`，否则 `not_found`；
- 服务正在运行（TCP 探测为 `running`），或存在 `chat.db-wal`/`chat.db-shm`，返回
  `{"error":{"code":"unavailable","message":"服务运行中，备份已暂停"}}`；
- 备份目录按 `--backup-dir` 的等价规则解析：`config.json` 的 `backup_dir` > `<dataDir>/backups`。

成功示例：

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "file": "chat-deepseek-20261127-012500.zip",
    "path": "/home/<user>/chat-deepseek/data/backups/chat-deepseek-20261127-012500.zip",
    "size": 50529024
  }
}
```

服务运行中示例：

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "error": { "code": "unavailable", "message": "服务运行中，备份已暂停" }
}
```

### 4.6 `backup.restore`

用备份覆盖 `config.json`、`chat.db`、`master.key` 和 `files/`，复用 `internal/backup.Restore`。

参数：

| 字段   | 类型   | 必填 | 说明                                   |
| ------ | ------ | ---- | -------------------------------------- |
| `file` | string | 是   | 备份目录内的 `.zip` 文件名，不能带路径 |

结果：

| 字段       | 类型     | 可空 | 说明                                                                 |
| ---------- | -------- | ---- | -------------------------------------------------------------------- |
| `ok`       | bool     | 否   | 成功固定 `true`                                                      |
| `restored` | string[] | 否   | 归档里实际恢复的数据条目，如 `["chat.db","config.json","files/..."]` |

前置条件与 CLI 相同：服务运行中或存在 `chat.db-wal`/`chat.db-shm` 时返回
`{"error":{"code":"unavailable","message":"服务运行中，恢复已暂停"}}`，不会绕过 WAL 检查。

`file` 必须是**备份目录内的普通 `.zip` 文件名**：含 `/`、`\`、绝对路径、`..`、符号链接或空字节一律
`bad_request`；不存在为 `not_found`；不是合法 ZIP、包含非法归档路径或没有 `chat.db` 为 `bad_request`。

成功示例：

```json
{ "jsonrpc": "2.0", "id": 6, "result": { "ok": true, "restored": ["chat.db", "config.json"] } }
```

### 4.7 `backup.delete`

删除备份目录内的一个归档。参数同 `backup.restore` 的 `file`，结果固定 `{"ok":true}`。

校验规则与 `backup.restore` 相同：只接受备份目录内的普通 `.zip` 文件名，路径穿越和符号链接返回
`bad_request`；文件不存在返回 `not_found`。删除单个备份不会修改数据目录，因此不要求服务停止。

示例：

```json
{ "jsonrpc": "2.0", "id": 7, "result": { "ok": true } }
```

### 4.8 `service.start`

启动已安装的服务。复用 `internal/service` 的 systemd 逻辑（用户级 `systemctl --user`），
不另写进程管理；本版不支持 `--system`/`--foreground` 参数。

| 字段     | 类型                        | 可空 | 说明                                             |
| -------- | --------------------------- | ---- | ------------------------------------------------ |
| `state`  | `"running"` \| `"starting"` | 否   | 启动后 TCP 探测通过为 `running`，否则 `starting` |
| `pid`    | number                      | 否   | systemd 的 `MainPID`；查不到时为 `0`             |
| `listen` | string                      | 否   | `config.json` 里的监听地址                       |

- 启动/停止/重启同一时刻只允许一个在途操作。第二个并发请求立即返回
  `{"error":{"code":"unavailable","message":"服务操作正在进行，请稍候"}}`，避免双击按钮起两个进程。
- 平台不支持 systemd、unit 未安装或 `systemctl` 失败时返回 `unavailable`，`message` 为底层中文错误。
- 成功后自动开始 `event.service.log` 跟随（见 §5）。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "result": { "state": "running", "pid": 12345, "listen": "127.0.0.1:8091" }
}
```

### 4.9 `service.stop`

停止服务。成功返回 `{"state":"stopped"}`；失败语义同 `service.start`，返回 `unavailable`。

示例：

```json
{ "jsonrpc": "2.0", "id": 9, "result": { "state": "stopped" } }
```

### 4.10 `service.restart`

重启服务。字段与 `service.start` 相同；成功后重新开始日志跟随。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": { "state": "starting", "pid": 12346, "listen": "127.0.0.1:8091" }
}
```

### 4.11 `service.logs`

读取服务最近 N 行日志。日志源是 systemd 用户单元的 journal（`journalctl --user -u chat-deepseek.service`），
因为 `serve` 本身只写 stderr、不落日志文件。

参数：

| 字段   | 类型   | 必填 | 说明                                                                                  |
| ------ | ------ | ---- | ------------------------------------------------------------------------------------- |
| `tail` | number | 否   | 读取行数，默认 `200`，必须是正整数；超过 `5000` 按 `5000` 读取并返回 `truncated:true` |

结果：

| 字段        | 类型     | 可空 | 说明                                                  |
| ----------- | -------- | ---- | ----------------------------------------------------- |
| `lines`     | string[] | 否   | 最近的日志行，从旧到新；没有日志时为 `[]` 不是 `null` |
| `truncated` | bool     | 否   | `tail` 超过 `5000` 被截断时为 `true`，否则 `false`    |

- `journalctl` 不可用（非 Linux、未安装、无法连接用户 journal）时返回 `unavailable`，不会伪造空日志。
- 如果探测到服务正在运行，本方法会顺带开启 `event.service.log` 跟随；`service.start`/`service.restart`
  成功后也会开启。停止服务或 IPC 退出时跟随自动结束。
- 读取是快照；实时追加走事件，不要轮询 `service.logs` 做 tail。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "result": { "lines": ["chat-deepseek 正在监听 127.0.0.1:8091", "... "], "truncated": false }
}
```

### 4.12 `auth.whoami`

读取当前 ipc 进程的登录态。不需要参数；未登录不是错误，返回 `authenticated:false`。

| 字段            | 类型     | 可空       | 说明                                                 |
| --------------- | -------- | ---------- | ---------------------------------------------------- |
| `authenticated` | bool     | 否         | 是否已登录且会话有效                                 |
| `username`      | string   | 仅 true 时 | 当前账户名                                           |
| `groups`        | string[] | 仅 true 时 | 规范组名，按权限从低到高（`User`、`Admin`、`Owner`） |
| `expiresAt`     | string   | 仅 true 时 | 会话过期时间，RFC 3339（带本地时区偏移）             |

基础 `User` 组始终存在；客户端应按最高权限组展示角色，不要依赖数组顺序。

未登录 / 过期 / 会话失效时**只**返回：

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "authenticated": false } }
```

已登录示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "authenticated": true,
    "username": "gx",
    "groups": ["User", "Owner"],
    "expiresAt": "2026-11-27T09:00:00+08:00"
  }
}
```

登录态与 CLI 共用同一套运行时目录、同款会话文件（`version` 固定 `1`，权限 `0600`），
但文件归属**当前 ipc 进程**：文件名由 `PID` + 进程启动时间组成；进程启动时间不可用时，
改用进程内固定的随机标识，避免 PID 复用后继承旧登录。新启动的 ipc 进程找不到旧进程的文件，
因此进程退出后登录态自然失效；同一台机器上可以同时存在多个 ipc 进程，各自独立登录。

会话有效期 **12 小时**，并且是滑动续期：每次授权成功的请求（`auth.whoami`、`account.*`）
都会把数据库会话和本地文件的 `expires_at` 推到当前时间 + 12h，`auth.whoami` 返回新的
`expiresAt`。进程正常退出时 `Serve` 会 best-effort 吊销会话并删除会话文件，失败只写 stderr。

### 4.13 `auth.login`

用账户密码建立当前 ipc 进程的登录态。成功后返回与 `auth.whoami` 已登录时相同的形状。

参数：

| 字段       | 类型   | 必填 | 说明                     |
| ---------- | ------ | ---- | ------------------------ |
| `username` | string | 是   | 去除首尾空白后不能为空   |
| `password` | string | 是   | 明文密码，只用于本次校验 |

- 只有 `Admin` 或 `Owner` 可以登录，语义与 CLI `chat-deepseek login` 一致；`User` 账户返回
  `permission_denied`，message 为「该账户没有 CLI 管理权限」。
- 会话有效期 **12 小时**，滑动续期：每次授权成功的请求会自动续到当前时间 + 12h，
  `auth.whoami` 返回新的 `expiresAt`；进程退出后会话即失效。
- 明文 token 只写入会话文件（`0600`），数据库只保存 token 的 SHA-256 哈希；密码、token
  都不会出现在日志或错误 message 里。
- 同一进程重复登录会吊销该进程的旧会话并替换会话文件。
- 凭据错误返回 `unauthenticated`，message 分别为「账户不存在」「密码错误」「账户已被禁用」；
  参数缺失或密码超过 1024 字节返回 `bad_request`。

成功示例：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "authenticated": true,
    "username": "gx",
    "groups": ["User", "Admin"],
    "expiresAt": "2026-11-27T09:00:00+08:00"
  }
}
```

### 4.14 `auth.logout`

吊销当前 ipc 进程的登录会话并删除会话文件。不需要参数，幂等：未登录时也返回成功。

```json
{ "jsonrpc": "2.0", "id": 3, "result": { "ok": true } }
```

数据库不可用时仍会尽力删除本地会话文件；登录态在进程内立即失效。

### 4.15 `account.list`

列出全部账户，需要 `Admin` 或 `Owner`。不需要参数。

| 字段                   | 类型     | 可空 | 说明                                         |
| ---------------------- | -------- | ---- | -------------------------------------------- |
| `accounts`             | object[] | 否   | 按用户名排序；没有账户时为 `[]`，不是 `null` |
| `accounts[].id`        | string   | 否   | 账户 ID                                      |
| `accounts[].username`  | string   | 否   | 用户名                                       |
| `accounts[].groups`    | string[] | 否   | 规范组名，按权限从低到高                     |
| `accounts[].disabled`  | bool     | 否   | 是否已禁用                                   |
| `accounts[].createdAt` | string   | 否   | 创建时间，RFC 3339（带本地时区偏移）         |
| `accounts[].self`      | bool     | 否   | 是否为当前会话账户                           |

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "accounts": [
      {
        "id": "u_...",
        "username": "gx",
        "groups": ["User", "Owner"],
        "disabled": false,
        "createdAt": "2026-11-02T09:14:00+08:00",
        "self": true
      }
    ]
  }
}
```

返回里没有密码哈希、token 或任何密钥字段。

### 4.16 `account.add`

创建账户，需要 `Admin` 或 `Owner`。

参数：

| 字段       | 类型     | 必填 | 说明                                   |
| ---------- | -------- | ---- | -------------------------------------- |
| `username` | string   | 是   | 1-64 个 ASCII 字母、数字或 `.` `_` `-` |
| `password` | string   | 是   | 新密码，8-1024 字节                    |
| `groups`   | string[] | 否   | 附加组；省略或空数组时默认 `["User"]`  |

- 组名 `User`/`Admin`/`Owner` 大小写不敏感，输出与保存使用规范名。
- **指定非空 `groups` 就需要 Owner**（即使只写 `["User"]`），语义与 CLI
  `user add --group ...` 一致；Admin 只能创建普通 `User`，否则返回 `permission_denied`，
  message 为「只有 Owner 可以指定组；Admin 只能创建普通 User」。`groups: []` 等同省略。
- 用户名已存在（大小写不敏感）返回 `conflict`；用户名、密码或组名非法返回 `bad_request`。

成功示例：

```json
{ "jsonrpc": "2.0", "id": 5, "result": { "ok": true } }
```

### 4.17 `account.password`

重置账户密码，需要 `Admin` 或 `Owner`。

参数：

| 字段       | 类型   | 必填 | 说明                |
| ---------- | ------ | ---- | ------------------- |
| `username` | string | 是   | 目标账户            |
| `password` | string | 是   | 新密码，8-1024 字节 |

- 权限规则与 CLI `user reset-password` 一致：非 Owner 只能操作权限**严格更低**的账户；
  重置同级或更高权限账户返回 `permission_denied`，message 为「只有 Owner 可以操作 <username> 账户」。
- 成功后吊销目标账户的**全部**登录会话，与 CLI 一致。重置自己的密码会让当前 ipc 立即退出登录。
- 目标不存在返回 `not_found`；密码或参数非法返回 `bad_request`。

成功示例：

```json
{ "jsonrpc": "2.0", "id": 6, "result": { "ok": true } }
```

### 4.18 `account.delete`

删除账户，需要 `Admin` 或 `Owner`。

参数：

| 字段       | 类型   | 必填 | 说明     |
| ---------- | ------ | ---- | -------- |
| `username` | string | 是   | 目标账户 |

- 权限规则同 `account.password`：非 Owner 不能删除同级或更高权限账户。
- 不能删除当前会话账户。检查顺序与 CLI 一致：先 `canOperate`，再检查 self。因此非 Owner 删除自己
  会先命中「只有 Owner 可以操作 <username> 账户」，只有 Owner 删除自己才会返回
  「不能删除自己」（两者都是 `permission_denied`）。
- 目标不存在返回 `not_found`。该方法没有确认参数；GUI/外壳需要自己先让用户确认。
- 与 CLI 一致：删除账户不会自动删除其附件文件，文件留在数据目录中。

成功示例：

```json
{ "jsonrpc": "2.0", "id": 7, "result": { "ok": true } }
```

### 4.19 `config.set`

写入 `config.json`，**不需要登录**（与 CLI `config set` 一致：继承启动 ipc 的操作系统用户）。
返回值是与 `config.get` 相同的投影，表示保存后的生效值。

参数（至少提供一个，未知字段忽略）：

| 字段        | 类型   | 必填 | 说明                                                       |
| ----------- | ------ | ---- | ---------------------------------------------------------- |
| `listen`    | string | 否   | `host:port`；空值非法                                      |
| `backupDir` | string | 否   | 绝对路径；空字符串表示清除配置，回落到 `<dataDir>/backups` |
| `apiOrigin` | string | 否   | `http(s)://` URL；不能带查询参数或片段；空值非法           |

- 读取现有配置 → 合并三个允许字段 → 一次原子写回；`public_url` 和未知字段保持原样。
- `listen`/`apiOrigin` 修改后需要重启 `serve` 才生效；`backupDir` 在下一次备份时生效。
- 校验失败返回 `bad_request`，不会留下半写文件；读写失败返回 `internal`。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "result": {
    "dataDir": "/home/<user>/chat-deepseek/data",
    "listen": "127.0.0.1:8091",
    "apiOrigin": "https://api.deepseek.com",
    "backupDir": "/home/<user>/chat-deepseek/data/backups",
    "version": "0.1.4-official0.1.4"
  }
}
```

### 4.20 `service.install`

安装用户级 systemd unit，复用 `internal/service` 的 `Install`。不需要登录
（与 CLI `service install` 一致）。

参数（可省略）：

| 字段    | 类型 | 必填 | 说明                                                                             |
| ------- | ---- | ---- | -------------------------------------------------------------------------------- |
| `force` | bool | 否   | `true` 覆盖已有 unit（对应 CLI `--force`），用于桌面端「重新安装」；默认 `false` |

| 字段       | 类型   | 可空 | 说明                         |
| ---------- | ------ | ---- | ---------------------------- |
| `ok`       | bool   | 否   | 成功固定 `true`              |
| `unitPath` | string | 否   | 实际写入的 unit 文件绝对路径 |

- 始终使用 `ScopeUser`；本版不支持 `--system`/`--enable`/`--disable`，`force` 替代 `--force`。
- `force` 不传、为 `null`（等同省略）或为 `false` 时，unit 已存在返回 `unavailable` 并带 CLI 同款提示；
  `force:true` 时覆盖已有 unit 并重新执行 `daemon-reload`。安装成功也不会自动启动服务，
  需要再调用 `service.start`。
- `force` 不是布尔值（`null` 除外）返回 `bad_request`，且不会写 unit。
- 非 Linux、没有运行中的 systemd、找不到 `systemctl`，或数据目录尚未初始化（没有活动 Owner）时返回
  `unavailable`，message 为底层中文原因。
- 与 `service.start/stop/restart` 共用同一把服务操作信号量；并发时返回
  `{"error":{"code":"unavailable","message":"服务操作正在进行，请稍候"}}`。
- 安装 warning（例如未开启 linger）只写 stderr，不进入结果字段。

成功示例：

```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "result": { "ok": true, "unitPath": "/home/<user>/.config/systemd/user/chat-deepseek.service" }
}
```

### 4.21 `service.uninstall`

停止并删除用户级 systemd unit。不需要参数，也不需要登录。

| 字段 | 类型 | 可空 | 说明                                |
| ---- | ---- | ---- | ----------------------------------- |
| `ok` | bool | 否   | 成功固定 `true`（未安装也返回成功） |

- 幂等：unit 本来就不存在时返回 `{"ok":true}`，与 CLI「服务未安装」+ 退出码 0 一致。
- 不修改数据目录、`config.json` 或数据库。
- 非 Linux / 没有 systemd / `systemctl` 失败返回 `unavailable`，message 为底层中文原因；
  与其它服务操作共用同一把信号量。

成功示例：

```json
{ "jsonrpc": "2.0", "id": 10, "result": { "ok": true } }
```

## 5. 事件

当前只有一种事件：

```json
{ "jsonrpc": "2.0", "method": "event.service.log", "params": { "line": "...", "stream": "stdout" } }
```

| 字段            | 类型                     | 说明                                                                                 |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `method`        | string                   | 固定 `event.service.log`                                                             |
| `params.line`   | string                   | 一行日志；可能包含换行，JSON 中会转义                                                |
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

登录（`<password>` 换成真实密码，注意别写进 shell 历史）：

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"auth.login","params":{"username":"owner","password":"<password>"}}' \
  | /tmp/chat-deepseek ipc --data-dir ./data 2>/tmp/ipc.log
```

登录态只属于当前 ipc 进程：上面的命令结束后进程退出，下一次 `ipc` 调 `auth.whoami` 会返回
`{"authenticated":false}`，这是预期行为。要在同一个进程里连续操作，请保持 stdin 打开，
**先读到 `auth.login` 的响应，再发下一个请求**；一次性把多行灌进管道时请求是并发执行的。

账户写方法要先在同一进程内登录，然后逐条发送（下面是请求行示例，不是 shell 命令）：

```text
{"jsonrpc":"2.0","id":1,"method":"account.list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"account.add","params":{"username":"alice","password":"<password>"}}
{"jsonrpc":"2.0","id":3,"method":"account.delete","params":{"username":"alice"}}
```

`config.set` 与 `service.install/uninstall` 不要求登录，可以单独跑：

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"config.set","params":{"backupDir":"/home/<user>/chat-deepseek/backups"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"service.install","params":{}}' \
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
  '{"jsonrpc":"2.0","id":4,"method":"account.list","params":{}}' \
  | /tmp/chat-deepseek ipc --data-dir ./data
# 应得到 bad_request（id=null）、not_found（id=2）、bad_request（id=3）和
# unauthenticated（id=4），进程不退出
```

`Ctrl-D`（stdin EOF）后进程以 0 退出。GUI 可以常驻一个 `ipc` 子进程，按请求写一行、按 `id` 读响应，
同时监听没有 `id` 的事件行。

## 8. 与 `/api/v1` 的分工

|          | `ipc`（本地控制面）                                                  | `/api/v1`（数据面）               |
| -------- | -------------------------------------------------------------------- | --------------------------------- |
| 传输     | 本机 stdio，NDJSON                                                   | HTTP/JSON + SSE                   |
| 使用者   | 桌面 GUI、Android 外壳、本机脚本/agent                               | 浏览器 Web 客户端                 |
| 身份     | 继承启动它的操作系统用户；管理员登录使用 CLI 同款会话文件            | Cookie 会话 + 内存 CSRF           |
| 能力     | 状态、能力、配置读写、备份、服务启停/安装/卸载与日志、认证与账户管理 | 账户、会话、消息、附件、设置、Key |
| 网络暴露 | 不监听端口                                                           | 按 `listen`/反代暴露              |
| 错误     | 字符串错误码                                                         | HTTP 状态码 + JSON 错误           |

边界：

- **ipc = 本地控制面 + GUI；HTTP = 浏览器数据面；两者不混用。** GUI 不拼 CLI、不解析中文，也不通过 HTTP 调管理操作。
- `ipc` 会写备份目录、恢复数据目录、写 `config.json`、安装/卸载 systemd unit，并可创建/改密/删除账户；
  密码只出现在 `auth.login`/`account.*` 的请求参数里，不落盘、不写日志。它**不写聊天数据、不传 API Key**，不是第二个业务 API。
- `account.*` 的权限与 CLI `user ...` 一致（Admin 起步，改组与高权限账户操作需要 Owner）。
  `config.set`、`service.install/uninstall` 与 CLI 对应命令一样**不要求登录**。
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
- 登录态 TTL 12 小时、每次授权成功的请求续期；ipc 进程退出时主动清理本进程会话，
  新进程也不会找到旧进程的文件，同一台机器上的多个 ipc 实例各自独立登录。
  进程启动时间读不到时会使用进程内固定的随机标识，而不是退化成 `PID-0.json`。
- 只有 Admin/Owner 能调用 `auth.login`；普通 User 不能登录本地管理面，和 CLI 一致。
- `account.delete` 没有二次确认参数，调用方必须先让用户确认；删除账户不会清理其附件文件。
- 基础 `User` 组始终存在，所以组数组通常是 `["User","Admin"]` / `["User","Owner"]`；
  客户端按最高权限组展示角色，不要依赖数组顺序，也不要假设数组里只有管理组。
- `account.add` 的 `groups: []` 视为未指定，默认创建 `["User"]`；只有非空 groups 才要求 Owner。
- `config.set` 只支持 `listen`/`backupDir`/`apiOrigin`，不能通过 IPC 设置 `public_url`，也不能清空 `listen`/`apiOrigin`。
- `config.set`、`service.install`、`service.uninstall` 与 CLI 对应命令一样**不要求登录**；
  能调用 ipc 的操作系统用户即可修改配置或安装/卸载用户级 unit。
- `service.install` 只安装用户级 unit，不设置开机自启，也不支持 `--system`；默认不覆盖已有 unit
  （`unavailable`），需要重新安装或更新 unit 时传 `force:true`，或先 `service.uninstall` 再安装。
