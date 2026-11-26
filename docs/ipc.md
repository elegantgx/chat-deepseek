# 本地控制面 IPC（v1）

> 面向桌面 GUI、Android 外壳和自动化 agent 的只读机器接口。
> 传输是 stdio + NDJSON，信封是 JSON-RPC 2.0 形状；stdout 只有协议行，日志只写 stderr。

## 1. 为什么需要它

桌面 GUI 目前通过拼接 CLI 参数、解析中文输出（`gui/parsing.py`）来获取服务状态、配置和备份列表。这条路径脆弱：

- 中文文案、表格列宽、退出码一变，GUI 就要同步改解析器；
- 只能拿到「给人看」的文本，拿不到稳定的字段类型；
- Android 等新外壳无法直接复用 Python 解析层。

`ipc` 把同一批事实变成结构化 JSON：字段名、类型、错误码固定，GUI 不再解析文本，Android/脚本也可以复用同一契约。它只做**控制面**的只读投影，不替代 HTTP 数据面。

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

约定：

- `jsonrpc` 必须是字符串 `"2.0"`，否则 `bad_request`；`method` 必须是非空字符串。
- `id` 原样回显，支持数字或字符串；缺失 `id` 的合法请求按 JSON-RPC notification 处理：执行但不返回响应。
- 无法解析的 JSON 会返回 `bad_request`，此时 `id` 为 `null`，服务不退出。
- v1 不校验 `params`，未知字段/未知参数一律忽略，便于向前兼容。
- 事件（`method` 字段、无 `id` 的 `event.*`）在 v1 **不实现**；`event.service.log` 等留给后续版本。

## 3. 错误码

错误码是字符串；调用方按字符串匹配，不要按数字。括号内是对齐的 CLI 退出码语义。

| code | 含义 | CLI 退出码 | v1 是否出现 |
| --- | --- | --- | --- |
| `bad_request` | JSON 坏、信封字段非法、请求行超长 | 2 | 是 |
| `internal` | 读配置/读备份目录等本机内部错误 | 1 | 是 |
| `unauthenticated` | 未登录或登录过期 | 3 | 否（预留给写方法） |
| `permission_denied` | 已登录但权限不足 | 4 | 否（预留给写方法） |
| `not_found` | 方法不存在；后续也用于资源不存在 | — | 是 |
| `unavailable` | 依赖的服务/能力不可用 | — | 否（预留） |

错误对象只有 `code`、`message` 两个字段；`message` 用于诊断，不保证稳定，**不要解析它做逻辑判断**。

## 4. 方法

v1 只有四个只读方法，均不需要参数，也都不读取数据库、不写任何文件。

### 4.1 `system.status`

探测配置里的监听地址，返回版本、数据目录和服务状态。

| 字段 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `version` | string | 否 | 构建版本，如 `0.1.4-official0.1.4` |
| `dataDir` | string | 否 | 数据目录绝对路径 |
| `service` | object | 否 | 服务探测结果 |
| `service.state` | `"running"` \| `"stopped"` \| `"unknown"` | 否 | 见下 |
| `service.listen` | string | 否 | `config.json` 里的监听地址（未改动） |
| `service.source` | `"probe"` | 否 | 状态来源；v1 固定为 TCP 探测 |

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
| `methods` | string[] | 否 | 实际注册的方法名，顺序稳定；v1 为下文四个 |
| `features` | object | 否 | 平台特性开关 |
| `features.systemd` | bool | 否 | v1 固定 `false` |
| `features.ssh` | bool | 否 | v1 固定 `false` |
| `features.autostart` | bool | 否 | v1 固定 `false` |
| `ipcVersion` | number | 否 | 控制面契约版本；v1 为 `1` |

`methods` 与注册表同源（由 `internal/ipc` 的方法表生成），不会出现「声明了但调不通」或反之。

示例：

```json
{"jsonrpc":"2.0","id":2,"result":{"platform":"linux","methods":["system.status","system.capabilities","config.get","backup.list"],"features":{"systemd":false,"ssh":false,"autostart":false},"ipcVersion":1}}
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
| `backups[].mtime` | string | 否 | 归档时间，RFC 3339（带本地时区偏移），如 `2026-11-26T02:14:00+08:00` |
| `dir` | string | 否 | 备份目录绝对路径 |

注意：`internal/backup.List` 当前只识别普通文件形式的 `.zip`（这是 CLI 的实际产物），v1 **不额外扫描** `.tar.gz` 等其它后缀。目录不存在属于正常情况，返回空数组而不是错误。`mtime` 与 CLI 一致：文件名里带 `YYYYMMDD-HHMMSS` 时优先用它，否则退回文件修改时间。

示例：

```json
{"jsonrpc":"2.0","id":4,"result":{"backups":[{"file":"chat-deepseek-20261126-021400.zip","path":"/home/<user>/chat-deepseek/data/backups/chat-deepseek-20261126-021400.zip","size":50529024,"mtime":"2026-11-26T02:14:00+08:00"}],"dir":"/home/<user>/chat-deepseek/data/backups"}}
```

## 5. 版本号策略

- `system.capabilities.ipcVersion` 是控制面契约版本，v1 为整数 `1`。
- **向后兼容的增量**（新增方法、新增字段、新增错误码）不升 `ipcVersion`；客户端必须忽略不认识的字段/方法。
- **破坏性变更**（删除/重命名方法或字段、改变字段含义、改变错误码语义）升主版本。
- 客户端应先调用 `system.capabilities`：若 `ipcVersion > 1`，提示升级外壳或降级使用。
- `version` 是产品版本（构建期注入），与 `ipcVersion` 独立；不要用产品版本判断协议能力。

## 6. 手工调试

在仓库根目录构建并喂几行请求（stdout 是协议，stderr 另存）：

```sh
go build -o /tmp/chat-deepseek ./cmd/chat-deepseek

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"system.capabilities","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"system.status","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"config.get","params":{}}' \
  '{"jsonrpc":"2.0","id":4,"method":"backup.list","params":{}}' \
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
  | /tmp/chat-deepseek ipc --data-dir ./data
# 应先后得到 bad_request（id=null）和 not_found（id=2），进程不退出
```

`Ctrl-D`（stdin EOF）后进程以 0 退出。GUI 可以常驻一个 `ipc` 子进程，按请求写一行、按 `id` 读响应。

## 7. 与 `/api/v1` 的分工

| | `ipc`（控制面） | `/api/v1`（数据面） |
| --- | --- | --- |
| 传输 | 本机 stdio，NDJSON | HTTP/JSON + SSE |
| 使用者 | 桌面 GUI、Android 外壳、本机脚本/agent | 浏览器 Web 客户端 |
| 身份 | 继承启动它的操作系统用户；v1 无登录 | Cookie 会话 + 内存 CSRF |
| 能力 | 只读：状态、能力、配置、备份列表 | 账户、会话、消息、附件、设置、Key |
| 网络暴露 | 不监听端口 | 按 `listen`/反代暴露 |
| 错误 | 字符串错误码 | HTTP 状态码 + JSON 错误 |

边界：

- `ipc` 不写数据库、不改配置、不创建备份；需要写操作时先加方法并升 `ipcVersion`，不要偷偷复用数据面接口。
- 不要通过 `ipc` 传密钥、密码或聊天内容；它是本地控制面，不是第二个业务 API。
- 浏览器仍只走 `/api/v1`；`ipc` 不引入新的前端可用接口。
