# desktop/ — Electron 桌面端骨架

状态：**骨架**。能启动窗口、能通过 preload 与主进程通信、能把请求转发给 Go 的 `ipc` 子进程、渲染层能热更；
页面、路由、视觉、业务全部未实现（`renderer/app.tsx` 只是占位）。

技术选择：主进程/preload 用 `tsc` 直接编译（不额外引 bundler），渲染层用 rspack（`target: web`）打包，
`index.html` 由 Electron `loadFile` 走 `file://` 加载。依赖全部复用仓库根 `node_modules`，
`desktop/` 下**不装 node_modules、不生成 lockfile**。

## 目录

```text
desktop/
  main.ts            主进程：窗口、单实例、spawn Go 后端、NDJSON 转发、超时兜底
  preload.ts         预加载：只向 window.host 暴露 request / onEvent
  ipc.d.ts           三端共享的 IPC 类型契约（纯类型，不进产物）
  rspack.config.ts   渲染层构建配置（输出 dist/renderer）
  tsconfig.json      渲染层类型检查（noEmit）
  tsconfig.main.json 主进程 + preload 编译（NodeNext → CJS，输出 dist）
  package.json       仅声明 "type": "commonjs" + main 入口，无依赖
  renderer/
    index.html       挂载点，HtmlRspackPlugin 注入 defer 脚本
    main.tsx         挂载 React
    app.tsx          占位壳：一行标题 + 四个空导航项 + 后端状态
  dist/              构建产物（根 .gitignore 已忽略）
```

`desktop/package.json` 里的 `"type": "commonjs"` 是必需的，不是笔误：根 `package.json` 是
`"type": "module"`，Node/Electron 按**最近的 package.json** 决定 `.js` 的模块格式。

- `dist/preload.js`：`sandbox: true` 的 preload 必须是 CommonJS（Electron 不支持沙箱 preload 走 ESM），
  如果继承根作用域，`.js` 会被当成 ESM，preload 直接加载失败。
- `dist/main.js`：CJS 下 `__dirname`、`require('electron')` 都是现成的，preload 路径不用额外绕。

这个文件不声明依赖，所以不会产生 `desktop/node_modules` 或第二个 lockfile；`rspack.config.ts`
也刻意用 `require` / `module.exports`，理由相同（否则 Node 原生 TS 加载器会先报一次 ESM 警告再回退）。

## 构建与运行

在仓库根执行：

```sh
# 1) 类型检查（渲染层）
pnpm exec tsc -p desktop/tsconfig.json --noEmit

# 2) 主进程 + preload → desktop/dist/main.js、desktop/dist/preload.js
pnpm exec tsc -p desktop/tsconfig.main.json

# 3) 渲染层 → desktop/dist/renderer/
pnpm exec rspack build -c desktop/rspack.config.ts

# 4) 启动
pnpm exec electron desktop/dist/main.js

# 冒烟：不显示窗口，只自检两条链路后自退
pnpm exec electron desktop/dist/main.js --smoke
```

`--smoke`（或 `CHAT_DEEPSEEK_SMOKE=1`）**不会在屏幕上弹窗**：窗口始终 `show: false`，永远不调 `show()`。
它等渲染层 `did-finish-load` 后打印 `[smoke] renderer loaded (window hidden)`，然后走两条链路各打一次真实请求：

- 主进程直连 Go 后端：`system.capabilities`；
- 渲染层 ↔ preload ↔ ipcMain：`window.host.request('system.status')`。

800ms 后自动退出；4.5s 内渲染层没加载完会打日志并以退出码 1 结束。冒烟还会用 `mkdtemp` 建一个
临时 userData（`app.setPath('userData', …)`），**不碰真实配置目录**，也因为单实例锁文件在 userData 里，
不会和用户正在跑的实例互相干扰；退出时删除该目录。

正常启动（不加 `--smoke`）仍要求 userData 可写。容器 / HOME 只读的环境里若不指走 userData，
Chromium 会直接 SIGTRAP，并把 `SingletonCookie` / `SingletonLock` / `SingletonSocket` 落到当前目录：

```sh
XDG_CONFIG_HOME=$PWD/tmp/xdg pnpm exec electron desktop/dist/main.js
# 或者：pnpm exec electron desktop/dist/main.js --user-data-dir=$PWD/tmp/electron-userdata
```

这些只是本地测试参数，不要写进产品启动脚本。

建议在根 `package.json` 加这几个脚本（本骨架没有改根 `package.json`）：

```json
"desktop:type": "tsc -p desktop/tsconfig.json --noEmit",
"desktop:build:main": "tsc -p desktop/tsconfig.main.json",
"desktop:build:renderer": "NODE_ENV=production rspack build -c desktop/rspack.config.ts",
"desktop:build": "pnpm desktop:build:renderer && pnpm desktop:build:main",
"desktop:start": "pnpm desktop:build && electron desktop/dist/main.js",
"desktop:smoke": "pnpm desktop:build && electron desktop/dist/main.js --smoke"
```

## 开发热更

```sh
# 终端 1：渲染层 dev server（8092，HMR）
pnpm exec rspack serve -c desktop/rspack.config.ts

# 终端 2：让主进程加载 dev server 而不是 file://（仅未打包时生效）
CHAT_DEEPSEEK_RENDERER_URL=http://localhost:8092 pnpm exec electron desktop/dist/main.js
```

- 只改 `renderer/**` → HMR 生效，不用重启窗口。
- 改 `main.ts` / `preload.ts` → 重跑 `tsc -p desktop/tsconfig.main.json` 并重启 Electron（主进程没做热重载）。
- 生产/默认路径始终是 `file://dist/renderer/index.html`，不依赖 dev server。

## window.host 契约

preload 用 `contextBridge` 暴露，且只暴露这两个方法；渲染层拿不到 `ipcRenderer` 和 Node：

```ts
window.host = {
  request(method: string, params?: unknown): Promise<unknown>
  onEvent(cb: (method: string, params: unknown) => void): () => void
}
```

- `request` 成功时 resolve Go 的 `result` 原值；失败时 **reject 一个纯对象 `{code: string, message: string}`**
  （类型 `HostErrorPayload`）。不要指望它是 `Error` 实例：`Error` 跨 `contextBridge` 会被重建，
  自定义字段（`code`）会丢，所以这里刻意 reject 普通对象；判断分支只看 `code`，`message` 仅用于展示。
- `onEvent` 返回取消订阅函数，重复调用安全；`useEffect` 清理时必须调用。
- 纯浏览器里直接开渲染层（没有 preload）时 `window.host` 是 `undefined`，页面要容忍。
- 类型定义在 `desktop/ipc.d.ts`，`tsconfig.json` 已 include，渲染层可直接用 `window.host`。

## 主进程能产生的事件（`onEvent` 收到）

| method                | params                                                   | 时机                                                        |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `event.backend.state` | `{available: boolean, binary?: string, reason?: string}` | 子进程 spawn 成功 / 启动失败 / 意外退出                     |
| 其它 `event.*`        | 原样转发                                                 | Go stdout 上无 `id` 的帧（v1 协议暂未实现事件，通道先留好） |

## 与 Go 的通信

- 启动：`<CHAT_DEEPSEEK_BIN 或 $PWD/chat-deepseek> ipc`，stdio 三根管道都接管。
- 协议：NDJSON，一行一个 JSON，信封是 JSON-RPC 2.0 形状。主进程**只按 `id` 配对转发，不解析业务字段**。
- 请求：`{"jsonrpc":"2.0","id":1,"method":"system.status","params":{}}`
- 响应：`{"jsonrpc":"2.0","id":1,"result":{...}}`
- 错误：`{"jsonrpc":"2.0","id":1,"error":{"code":"permission_denied","message":"..."}}`
- 事件：`{"jsonrpc":"2.0","method":"event.service.log","params":{...}}`（无 `id`）
- `id` 由主进程自增分配（数字），按数字匹配；响应可能乱序，不影响配对。
- 单条请求 10s 未响应 → reject `code: 'timeout'`；子进程退出时把所有挂起请求 reject 掉。
- 子进程 stderr 按行加 `[backend]` 前缀转发到主进程 `console.error`，**不丢弃**。
- 子进程起不来（文件不存在、无 `ipc` 子命令、立即退出）**不会崩窗口**：请求一律 reject
  `code: 'backend_unavailable'`，窗口照常显示。

错误码映射（渲染层拿到的 `error.code`，`error` 是 `{code, message}`）：

| code                  | 来源                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| `backend_unavailable` | 二进制不存在 / 未启动 / stdin 写失败 / 已退出                                     |
| `backend_exited`      | 请求挂起期间子进程退出                                                            |
| `timeout`             | 10s 超时                                                                          |
| `invalid_request`     | 传给 `request()` 的 method 不是非空字符串                                         |
| `backend_error`       | Go 的 error 缺 `code` 或形状不对                                                  |
| 其它字符串            | Go 的 `error.code` 原样透传，如 `bad_request` / `not_found` / `permission_denied` |

## 安全与窗口（固定配置，改之前先对齐）

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 窗口 1280×800、最小 1024×680、原生标题栏（不设 `frame` / `titleBarStyle`）。
- `backgroundColor` 取 `nativeTheme.shouldUseDarkColors`（深色 `#1f1f1f` / 浅色 `#ffffff`），
  并在 `nativeTheme` 更新时同步，避免加载期白闪。
- `show: false`；正常模式 `ready-to-show` 再 `show()`，冒烟模式永不显示。
- 单实例：`requestSingleInstanceLock()` 失败直接退出；第二个实例只唤起已有窗口。
- 退出时先给子进程 stdin EOF（协议里的正常关闭），再 `SIGTERM` 兜底。

## 标题栏与 Wayland（Linux）

现象：窗口顶栏是灰色老式 GTK 条。可能有两种来源，先确认再动手：

- 跑在 **XWayland**：边框由 mutter 按 X11 的服务器端装饰画；
- 已经跑在**原生 Wayland**，但由 Electron/GTK 自己画 CSD（Chromium 149 起原生 Wayland 的客户端装饰
  是 GTK 主题外观）—— 这种情况下换 switch 没用。

`main.ts` 在 `app.whenReady()` 之前保留了这两个 switch：

```ts
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,WaylandWindowDecorations')
```

**但在 Electron 45（Chromium 156.0.8078.109）上它们大概率是 no-op**，依据是静态检查（没启动 Electron）：

- `ozone-platform-hint`：上游在 Chromium 140（Electron 38）删除了该开关，因为平台选择默认值就是 `auto`；
  Electron 45 的二进制里已经查不到这个字符串，只剩 `--ozone-platform`。
  见 electron/electron#48001 <https://github.com/electron/electron/issues/48001>。
- `ELECTRON_OZONE_PLATFORM_HINT`：Electron 38 弃用、39 移除（同一个 issue），二进制里也查不到。
  所以**不要**再用这个环境变量做验证，它在 45 上不生效。
- `WaylandWindowDecorations`、`UseOzonePlatform`：Electron 45 的二进制里同样查不到；是否被改名或被
  默认行为吸收，没有确定结论。

保留这两个 switch 是按当前决定，不是已验证的修复；是否真的有用只能在用户桌面上看。

### 怎么确认跑在哪个后端

```sh
# 打开 Chromium 日志，看 ozone / wayland / x11 相关行
ELECTRON_ENABLE_LOGGING=1 pnpm exec electron desktop/dist/main.js 2>&1 | grep -iE 'ozone|wayland|x11'

# A/B：强制原生 Wayland（这个开关在 Electron 45 里确实存在）
pnpm exec electron desktop/dist/main.js --ozone-platform=wayland

# A/B：强制 XWayland
pnpm exec electron desktop/dist/main.js --ozone-platform=x11
```

`--ozone-platform=wayland` 在 X11 会话里会失败或回退，只用于对比，不要写死进产品。

### 各种情况下的预期

- **确实在 XWayland**：标题栏由窗口管理器做服务器端装饰，灰/老式是预期，不是 bug；只能切原生 Wayland 或自绘。
- **X11 会话**：本来就只有服务器端装饰，不会变成 CSD，看到老式标题栏同样不是 bug。
- **原生 Wayland**：Chromium 149+ 起客户端装饰是 GTK 主题外观（上游 CEF 的 changelog 可作为参考证据，
  不是 Electron 官方文档），所以灰色 GTK 顶栏也可能就是 Electron 自己画的 CSD。

### 候选方案（未实施，等用户定）

1. 先用上面的命令确认后端；如果是 XWayland 且值得切，再考虑 `--ozone-platform=wayland`
   （要按会话判断，别让 X11 用户起不来）；
2. 自绘标题栏（`frame: false` + `titleBarOverlay`/自己画）—— **违反「原生标题栏」约束**，要用户明确同意；
3. 降级到 Electron ≤37 可以继续用 `ozone-platform-hint` + `WaylandWindowDecorations` —— 不推荐
   （旧分支，缺安全更新）；
4. 等 Electron/Chromium 上游继续改 Wayland CSD 外观。

本骨架没有 `frame: false` / `titleBarStyle`，不会自行换方案。

## 发版

**打包还没做**，当前只有 `desktop/dist/` 这一份可运行产物。正式发版前需要补：

1. 选 electron-builder 或 electron-forge 打包；`desktop/package.json` 的 `main` 已指向 `dist/main.js`。
2. 把 Go 二进制作为 extraResource 随包分发，并用 `CHAT_DEEPSEEK_BIN` 指到 `process.resourcesPath` 下的路径
   —— 现在默认值是 `process.cwd()`，打包后不可靠。
3. 三平台产物、图标、代码签名、公证、自动更新都未做；版本号跟随根 `package.json`，桌面端不单独发版。

## 已知限制 / 未覆盖

1. **后端不自动重连**：Go 子进程退出后要重启应用；启动时若二进制不可用，所有请求都是
   `backend_unavailable`（窗口仍显示）。没有重试、没有退避、没有进程守护。
2. **Go 侧 `ipc` 子命令的进度不在本骨架的控制范围内**：协议细节以 `docs/ipc.md` 为准；
   本骨架按「一行一个 JSON、`id` 回显、stdout 只有协议、日志走 stderr」实现。
3. 渲染层没有 CSP、错误边界、路由、i18n、主题；`app.tsx` 只是占位，样式一行没写。
4. 主进程没有热重载，没有菜单定制、托盘、多窗口、协议处理（deep link）、自动更新。
5. 未在 Windows/macOS 实机验证；容器/CI 里若 `$HOME` 只读，正常启动必须把 userData 指到可写目录
   （见上文），否则 Chromium 直接 SIGTRAP；`chrome-sandbox` 缺 setuid 时还要临时加 `--no-sandbox`（仅测试用）。
6. `event.*` 事件通道已打通，但 `docs/ipc.md` 的 v1 不产出事件，所以真实环境里暂时只会看到
   `event.backend.state`。
7. 热更只验证了「dev server 起得来 + Electron 能加载它」；没有可视环境，没实际观察过改文件后的
   HMR 替换。`pnpm dev` 那套 8090/8091 与桌面端无关，桌面端 dev server 用 8092。
8. **Wayland 标题栏效果没有实跑验证**（只做了静态改动）：二进制里查得到 `--ozone-platform`，
   查不到 `ozone-platform-hint` / `WaylandWindowDecorations` / `UseOzonePlatform`（Electron 45，Chromium 156），
   所以那两个 switch 大概率无效；「是否变成客户端装饰」取决于会话类型和 compositor，必须由用户在自己桌面上看。
   另外「冒烟不弹窗 + 临时 userData」也只做了静态检查，没启动过 Electron。
