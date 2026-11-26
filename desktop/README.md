# desktop/ — Electron 桌面端

状态：**可用**。窗口、preload 桥、Go `ipc` 子进程、渲染层热更都通了；视觉按 `docs/desktop-visual.md`
定稿，服务/账户/备份/设置四个页面已经接真实 `ipc`。打包、代码签名、自动更新还没做。

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
    main.tsx         挂载 React（渲染层入口）
    app/             外壳：frame、hash 路由、主题、host 桥、mock 替身、状态栏
    pages/           服务 / 账户 / 备份 / 设置四个页面（只画纸面内容）
    ui/              设计系统：token、按钮、卡片、表格、对话框、Toast 等
    gallery/         组件总览页（单独入口，验收视觉用）
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
./node_modules/.bin/tsc -p desktop/tsconfig.json --noEmit

# 2) 主进程 + preload → desktop/dist/main.js、desktop/dist/preload.js
./node_modules/.bin/tsc -p desktop/tsconfig.main.json

# 3) 渲染层 → desktop/dist/renderer/
./node_modules/.bin/rspack build -c desktop/rspack.config.ts

# 4) 启动
./node_modules/.bin/electron desktop/dist/main.js

# 冒烟：不显示窗口，只自检两条链路后自退
./node_modules/.bin/electron desktop/dist/main.js --smoke
```

根 `package.json` 已收录三条等价入口：

```sh
pnpm desktop:build   # 主进程 tsc + 渲染层 rspack
pnpm desktop:start   # electron desktop/dist/main.js
pnpm desktop:check   # 渲染层类型检查
```

脚本内部写死 `./node_modules/.bin/...`，不依赖 `PATH` 里的 `pnpm` / `npx`（本机 corepack 缓存落在
只读家目录，用它们启动会失败），也不加 `--no-sandbox`。

`--smoke`（或 `CHAT_DEEPSEEK_SMOKE=1`）**不会在屏幕上弹窗**：窗口始终 `show: false`，永远不调 `show()`。
它等渲染层 `did-finish-load` 后打印 `[smoke] renderer loaded (window hidden)`，然后走两条链路各打一次真实请求：

- 主进程直连 Go 后端：`system.capabilities`；
- 渲染层 ↔ preload ↔ ipcMain：`window.host.request('system.status')`。

800ms 后自动退出；4.5s 内渲染层没加载完会打日志并以退出码 1 结束。冒烟还会用 `mkdtemp` 建一个
临时 userData（`app.setPath('userData', …)`），**不碰真实配置目录**，也因为单实例锁文件在 userData 里，
不会和用户正在跑的实例互相干扰；退出时删除该目录。所以它适合放进 CI：无窗口、无残留、退出码可判。

**本机环境注意**：这台机器的家目录只读，跑 `--smoke` 也必须先把 `XDG_CONFIG_HOME` 指到可写目录
（如 `$PWD/tmp/xdg`），否则 Chromium 仍会在启动阶段 SIGTRAP；冒烟只在 userData 上做了隔离，
`XDG_CONFIG_HOME` 不在它的接管范围内。

正常启动（不加 `--smoke`）仍要求 userData 可写。容器 / HOME 只读的环境里若不指走 userData，
Chromium 会直接 SIGTRAP，并把 `SingletonCookie` / `SingletonLock` / `SingletonSocket` 落到当前目录：

```sh
XDG_CONFIG_HOME=$PWD/tmp/xdg ./node_modules/.bin/electron desktop/dist/main.js
# 或者：./node_modules/.bin/electron desktop/dist/main.js --user-data-dir=$PWD/tmp/electron-userdata
```

这些只是本地测试参数，不要写进产品启动脚本。

## 开发热更

```sh
# 终端 1：渲染层 dev server（8092，HMR）
./node_modules/.bin/rspack serve -c desktop/rspack.config.ts

# 终端 2：让主进程加载 dev server 而不是 file://（仅未打包时生效）
CHAT_DEEPSEEK_RENDERER_URL=http://localhost:8092 ./node_modules/.bin/electron desktop/dist/main.js
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

- 启动：`<CHAT_DEEPSEEK_BIN 或 $PWD/chat-deepseek> ipc --data-dir <数据目录>`，stdio 三根管道都接管。
- 数据目录：默认 `<userData>/data`（Linux `~/.config/chat-deepseek/data`，macOS
  `~/Library/Application Support/chat-deepseek/data`）。用 `CHAT_DEEPSEEK_DATA_DIR` 可以指到别处——
  用户本来就在用 CLI 跑服务时，要让桌面端管同一份 `data/`，否则看到的是一个空控制台。
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
- 窗口 `title` 显式设为 `chat-deepseek`；渲染层 `index.html` 的 `document.title` 同名，加载后不会被改掉。
- `backgroundColor` 取 `nativeTheme.shouldUseDarkColors`（深色 `#1f1f1f` / 浅色 `#ffffff`），
  并在 `nativeTheme` 更新时同步，避免加载期白闪。
- `show: false`；正常模式 `ready-to-show` 再 `show()`，冒烟模式永不显示。
- 单实例：`requestSingleInstanceLock()` 失败直接退出；第二个实例只唤起已有窗口。
- 退出时先给子进程 stdin EOF（协议里的正常关闭），再 `SIGTERM` 兜底。

## 标题栏与 Wayland（Linux）

**当前结论（已实机验证）：Linux Wayland 会话默认退回 XWayland，这是有意识的取舍。**

- 原生 Wayland：Chromium 自绘窗口装饰，是灰底方角；
- XWayland：由 mutter 画服务器端 Adwaita 装饰（白底圆角、标题居中），且无模糊感——用户认可这一版。

`main.ts` 在 `app.whenReady()` 之前按会话选择平台，窗口 `title` 显式设为 `chat-deepseek`：

```ts
if (
  process.platform === 'linux' &&
  process.env.WAYLAND_DISPLAY &&
  !process.env.CHAT_DEEPSEEK_OZONE
) {
  app.commandLine.appendSwitch('ozone-platform', 'x11')
} else if (process.env.CHAT_DEEPSEEK_OZONE) {
  app.commandLine.appendSwitch('ozone-platform', process.env.CHAT_DEEPSEEK_OZONE)
}
```

- 未设置 `CHAT_DEEPSEEK_OZONE` 时：只有「Linux + 存在 `WAYLAND_DISPLAY`」才切 XWayland；
  X11 会话和 Windows/macOS 仍交给 Electron 自己选平台。
- 取舍的代价：XWayland 在分数缩放（125% / 150%）下可能发糊。XWayland 客户端通常按整倍渲染，
  再由合成器整体缩放，应用侧改不了；接受统一装饰，就接受这个风险。在意清晰度就显式回原生 Wayland。

### 覆盖与对照

`CHAT_DEEPSEEK_OZONE` 一旦设置，就会被原样追加为 `--ozone-platform`，覆盖上面的默认选择：

```sh
# 强制原生 Wayland（回到灰底方角的自绘装饰，用于对照）
CHAT_DEEPSEEK_OZONE=wayland ./node_modules/.bin/electron desktop/dist/main.js

# 强制 XWayland
CHAT_DEEPSEEK_OZONE=x11 ./node_modules/.bin/electron desktop/dist/main.js
```

不设置（或设为空字符串）就是上面的默认逻辑。值必须是 Electron/Chromium 认识的平台名，
写错会让进程在启动阶段失败——这个变量只用于对照，不要配进产品启动脚本。另外 `wayland` 值只在
Wayland 会话里可用，在纯 X11 会话里设它会因没有 Wayland compositor 而起不来。

> 旧结论保留：`ozone-platform-hint` 在 Chromium 140（Electron 38）被删除，
> `ELECTRON_OZONE_PLATFORM_HINT` 在 Electron 39 移除，`WaylandWindowDecorations` / `UseOzonePlatform`
> 在 Electron 45 的二进制里查不到（见 electron/electron#48001）。所以这里用现存的 `--ozone-platform`，
> 不再追加那两个 no-op switch。

### 怎么确认跑在哪个后端

```sh
# 打开 Chromium 日志，看 ozone / wayland / x11 相关行
ELECTRON_ENABLE_LOGGING=1 ./node_modules/.bin/electron desktop/dist/main.js 2>&1 | grep -iE 'ozone|wayland|x11'
```

- **X11 会话**：本来就只有服务器端装饰，不会出现 CSD，老式标题栏不是 bug。
- **Wayland 会话**：默认走 XWayland，标题栏归 mutter；`CHAT_DEEPSEEK_OZONE=wayland` 时归 Chromium 自绘。
- 仍坚持原生标题栏：没有 `frame: false` / `titleBarStyle`，不自绘窗口外壳。

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
3. 渲染层没有 CSP、错误边界、i18n；路由只有 hash（`#service` 等），没有多窗口。
4. 主进程没有热重载，没有菜单定制、托盘、多窗口、协议处理（deep link）、自动更新。
5. 未在 Windows/macOS 实机验证；容器/CI 里若 `$HOME` 只读，正常启动必须把 userData 指到可写目录
   （见上文），否则 Chromium 直接 SIGTRAP；`chrome-sandbox` 缺 setuid 时还要临时加 `--no-sandbox`（仅测试用）。
6. 事件通道有 `event.backend.state`（主进程发）和 `event.service.log`（Go 侧日志跟随）；
   服务日志只在 Linux 用户级 systemd + journalctl 可用时才有。
7. 热更只验证了「dev server 起得来 + Electron 能加载它」；没有可视环境，没实际观察过改文件后的
   HMR 替换。`pnpm dev` 那套 8090/8091 与桌面端无关，桌面端 dev server 用 8092。
8. **登录态绑定 ipc 进程**：会话文件按「PID + 进程启动时间」命名，TTL 12 小时并在每次成功请求后续期，
   进程退出会主动吊销；重启应用需要重新登录（v1 刻意不做「记住我」）。
9. **`service.*` 只有 Linux 用户级 systemd 实现**：其它平台返回 `unavailable`，页面会照原样展示后端文案。
10. **GPU 崩溃自动退回软件合成**：没有 `/dev/dri`（容器、部分虚拟机）、上次 GPU 崩溃留下的标记、
    显式 `--disable-gpu` 三种情况都直接走软件合成。有 GPU 但驱动/沙箱不让用时，Chromium 会对 GPU 进程
    重试三次后以「GPU process isn't usable. Goodbye.」SIGTRAP 退出；主进程收到第一次
    `child-process-gone` 就写标记文件 `<userData>/gpu-software` 并带 `--disable-gpu` 重启一次，
    标记写成功的话下次启动也会直接走软件合成，不会反复崩。想重新试硬件加速：
    `CHAT_DEEPSEEK_GPU=on` 启动一次（会清掉标记），或删掉那个文件。
11. **Wayland 标题栏只在这一台 Linux 桌面上验证**：Wayland 会话默认退回 XWayland、由 mutter 画 Adwaita
    装饰，这是用户认可的版本，代价是分数缩放下可能发糊；`CHAT_DEEPSEEK_OZONE=wayland` 可回原生 Wayland
    对照。其它 compositor 与 Windows/macOS 未验证。`--smoke` 链路已在 Linux 上用真实的
    `chat-deepseek` 二进制跑通（无窗口、临时 userData、退出码 0）。
