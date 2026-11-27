# desktop/ — Electron 桌面端

状态：**可用**。窗口、preload 桥、Go `ipc` 子进程、渲染层热更都通了；视觉按 `docs/desktop-visual.md`
定稿，服务/账户/备份/设置四个页面已经接真实 `ipc`。已接 electron-builder（三平台便携 zip）；代码签名、
公证与自动更新还没做。

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
  build/             图标 whale.{png,ico,icns}；backend/bin 是生成的 Go 二进制（不提交）
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
它等渲染层 `did-finish-load` 后打印 `[smoke] renderer loaded (window hidden)`，然后走两条链路各打一次真实请求，
并额外验证一次本地方法：

- 主进程直连 Go 后端：`system.capabilities`；
- 渲染层 ↔ preload ↔ ipcMain：`window.host.request('system.status')`；
- 本地方法（不经过 Go）：在临时 userData 里写一次 `desktop.json`，再读回 `desktop.dataDir`。

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
- `desktop.*`（数据目录读写、打开页面）是**主进程本地方法**，不转发 Go；契约见「数据目录与本地设置」。
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
  `~/Library/Application Support/chat-deepseek/data`）。解析优先级、`desktop.json` 和设置页用的
  `desktop.*` 方法见下一节；`CHAT_DEEPSEEK_DATA_DIR` 仍然最高，适合「本来就在用 CLI 跑服务，
  要让桌面端管同一份 `data/`」的场景。
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

## 数据目录与本地设置

桌面端启动 Go 后端时传的 `--data-dir` 按下面的优先级解析，先命中者生效：

1. `CHAT_DEEPSEEK_DATA_DIR` 环境变量（非空即覆盖，最高优先）；
2. `<userData>/desktop.json` 里的 `dataDir`（设置页保存的值）；
3. `<userData>/data`（默认）。

`<userData>` 来自 `app.getPath('userData')`（`app.setName('chat-deepseek')` 之后是
`~/.config/chat-deepseek`，macOS 为 `~/Library/Application Support/chat-deepseek`）。
`desktop.json` 只存桌面端自己的设置，当前只有一个字段：

```json
{ "dataDir": "/absolute/path/to/data" }
```

读取是容错的：文件不存在、JSON 坏了、`dataDir` 不是非空字符串，都按「未设置」处理（只在 stderr
留一行日志），继续回落到 `<userData>/data`，不会影响启动。写入用「同目录临时文件 + `rename`」保证
内容完整；设置目录不存在时先 `mkdirSync(..., { recursive: true })`。`--smoke` 使用临时 userData，
`desktop.json` 也跟着落在临时目录，不碰真实配置目录。

### 本地方法 `desktop.dataDir` / `desktop.dataDir.set`

这两个方法由**主进程本地处理**：不转发给 Go、不走 `/api/v1`，后端没启动（`backend === null`）时也
照常返回。它们和其它方法共用 `window.host.request` 通道，preload 不需要新接口。

```ts
// 读状态：无参数
await window.host.request('desktop.dataDir')
// {
//   current: '/home/<user>/.config/chat-deepseek/data', // 本次启动实际使用
//   saved: '',                                         // desktop.json 里的值，未设置为 ''
//   envOverride: null,                                 // CHAT_DEEPSEEK_DATA_DIR 解析后的路径
//   restartRequired: false,
// }

// 保存：必须是绝对路径；返回同形状，restartRequired 按新值计算
await window.host.request('desktop.dataDir.set', { dataDir: '/srv/chat-deepseek/data' })
```

- `current` 是**本次启动**真正传给 Go 的目录。保存只写 `desktop.json`，**重启应用后才生效**；
  `restartRequired = saved !== '' && resolve(saved) !== current`。
- 校验失败返回 `bad_request`（`dataDir 必须是非空字符串` / `dataDir 必须是绝对路径`）；环境变量
  已设置时返回 `unavailable`，界面不允许改，也不会写文件；写入失败或数据目录的父目录不可写返回
  `internal`（message 指出具体路径），不会假装保存成功。
- 保存时用 `path.resolve` 规范化；目标数据目录本次不创建（下次启动由 Go 侧创建），但会预检父目录。
- 成功写入后主进程打一行：`[desktop] 数据目录已保存为 …，重启应用后生效`。

### 本地方法 `desktop.openUrl`

`desktop.openUrl({ url })` 同样由**主进程本地处理**，用 Electron 的 `shell.openExternal(url)` 交给
系统默认浏览器。它**只接受 `http:` / `https:`**：参数不是对象、`url` 不是非空字符串、URL 解析失败
或协议不对都返回 `bad_request`（message 以 `url` 开头）；系统打开失败返回 `internal`。
成功结果是 `{ ok: true }`。

## 安全与窗口（固定配置，改之前先对齐）

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 窗口 1280×800、最小 1024×680，不设 `frame` / `titleBarStyle`
  （Linux Wayland 下装饰由 Chromium 自绘，见下文）。
- 窗口 `title` 显式设为 `chat-deepseek`；渲染层 `index.html` 的 `document.title` 同名，加载后不会被改掉。
- `backgroundColor` 取 `nativeTheme.shouldUseDarkColors`（深色 `#1f1f1f` / 浅色 `#ffffff`），
  并在 `nativeTheme` 更新时同步，避免加载期白闪。
- `show: false`；正常模式 `ready-to-show` 再 `show()`，冒烟模式永不显示。
- 单实例：`requestSingleInstanceLock()` 失败直接退出；第二个实例只唤起已有窗口。
- 退出时先给子进程 stdin EOF（协议里的正常关闭），再 `SIGTERM` 兜底。

## Ozone 平台与窗口装饰（Linux）

主进程**不切 Ozone 平台**，跟随 Electron 自己的选择（Wayland 会话走原生 Wayland，X11 会话走 X11），
GPU 与浏览器始终是同一套平台。

原因：平台在 `main.js` 执行之前就已经选好，`app.commandLine.appendSwitch('ozone-platform', …)`
改不了浏览器进程，只会把 `--ozone-platform` 塞进 GPU 等子进程，形成「浏览器 Wayland + GPU 走 X11/GLX」
的混合配置；Mesa iris 在这条路径上会 SIGSEGV（`GPU process exited unexpectedly: exit_code=11`），
而系统 Chrome 走纯 Wayland/EGL-GBM 没有这个问题。这条混合路径别再引回来。

Wayland 会话里的窗口装饰由 Chromium 自绘（灰底方角），不是 compositor 画的 Adwaita；
灰底和深色 UI 放在一起观感可以接受，所以不为装饰切 X11。仍然不设 `frame: false` / `titleBarStyle`，
不自绘窗口外壳。

需要确认实际跑在哪个后端时：

```sh
# Chromium 日志里的 ozone / wayland / x11 行
ELECTRON_ENABLE_LOGGING=1 ./node_modules/.bin/electron desktop/dist/main.js 2>&1 | grep -iE 'ozone|wayland|x11'

# 真有 X 窗口才说明浏览器是 X11（Wayland 窗口不会出现在这里）
xwininfo -root -tree | grep -i chat-deepseek
```

## 打包

用 electron-builder 出三平台便携 zip，配置在仓库根 `electron-builder.yml`。产物写到 `release/desktop/`
（已被根 `.gitignore` 的 `/release/` 覆盖），不使用根 `dist/`。

先构建随包分发的 Go 后端，再编译主进程/渲染层，最后打包：

```sh
# 1) Go 后端 → desktop/build/backend/bin/chat-deepseek[.exe]
#    GOOS/GOARCH 不设时跟随本机；tag 发布时用 VERSION 注入版本
pnpm desktop:backend

# 2) 主进程 tsc + 渲染层 rspack
pnpm desktop:build

# 3) 当前平台的便携 zip
pnpm desktop:pack:linux   # release/desktop/chat-deepseek-<version>-linux-amd64.zip
pnpm desktop:pack:mac     # ...-macos-arm64.zip（未签名，identity: null）
pnpm desktop:pack:win     # ...-windows-amd64.zip
```

不想用脚本时等价于：

```sh
./node_modules/.bin/electron-builder --linux zip --publish never
```

Linux zip 解压后就是应用目录（没有外层包名文件夹）：

```text
chat-deepseek              Electron 可执行文件
resources/
  app.asar                 desktop/dist（主进程、preload、渲染层）
  bin/chat-deepseek        随包的 Go 后端（也是 CLI）
...
```

macOS 的 zip 根是 `chat-deepseek.app`，后端在 `chat-deepseek.app/Contents/Resources/bin/chat-deepseek`。

- `extraResources` 把 `desktop/build/backend/bin/` 复制到 `resources/bin/`；主进程在 `app.isPackaged`
  时从 `process.resourcesPath` 取（Windows 文件名是 `chat-deepseek.exe`）。开发态仍先看
  `CHAT_DEEPSEEK_BIN`，否则用仓库根 `chat-deepseek`。打包态缺文件会返回可读的
  `backend_unavailable` 原因，不会静默崩。
- `desktop/package.json`（`"type": "commonjs"`）必须进 asar，且与 `desktop/dist/main.js` 保持最近关系；
  根 `package.json` 只提供 `main` 与版本。漏掉会让打包后的主进程按 ESM 解析，直接起不来。
- 只打进 `desktop/dist/**` 与两份 `package.json`，`node_modules` 被排除：主进程只用 electron/Node
  内置模块，渲染层已由 rspack 打包。asar 里没有 `node_modules`，包体积主要来自 Electron 本身。
- 版本取根 `package.json` 的 `0.1.5-official0.1.4`；`appId` 是 `com.chatdeepseek.desktop`；三个平台
  的产物名都带平台与架构。

本机验收用 `--smoke`（窗口始终 `show: false`，**不要裸跑可见窗口**）：

```sh
unzip -q release/desktop/chat-deepseek-*-linux-amd64.zip -d /tmp/cds-smoke
XDG_CONFIG_HOME=$PWD/tmp/xdg /tmp/cds-smoke/chat-deepseek --smoke
```

日志应包含 `[smoke] backend binary -> .../resources/bin/chat-deepseek (exists=true)`、
`renderer loaded (window hidden)`、`system.status` 返回，以及 `desktop.openUrl file:// -> ERR:bad_request`，
退出码 0。CI 的三个 workflow 用同一套 `desktop:backend` / `desktop:build` / electron-builder 命令。

打包会按需下载 Electron 与 7zip 工具集：首次运行需要网络。macOS/Windows 仅由 CI 构建，
未在本机实机验证；两者都不签名。

## 已知限制 / 未覆盖

1. **后端不自动重连**：Go 子进程退出后要重启应用；启动时若二进制不可用（含打包漏带
   `resources/bin`），所有请求都是 `backend_unavailable`（窗口仍显示，并带具体路径/原因）。
   没有重试、没有退避、没有进程守护。
2. **Go 侧 `ipc` 子命令的进度不在本骨架的控制范围内**：协议细节以 `docs/ipc.md` 为准；
   本骨架按「一行一个 JSON、`id` 回显、stdout 只有协议、日志走 stderr」实现。
3. 渲染层没有 CSP、错误边界、i18n；路由只有 hash（`#service` 等），没有多窗口。
4. 主进程没有热重载，没有菜单定制、托盘、多窗口、协议处理（deep link）、自动更新。
5. 未在 Windows/macOS 实机验证；容器/CI 里若 `$HOME` 只读，正常启动必须把 userData 指到可写目录
   （见上文），否则 Chromium 直接 SIGTRAP；`chrome-sandbox` 缺 setuid 时还要临时加 `--no-sandbox`（仅测试用）。
6. 事件通道有 `event.backend.state`（主进程发）和 `event.service.log`（Go 侧日志）；
   服务日志有两个来源：装了 systemd 用户单元时读 journal（`journalctl -o json`，保留真实时间与级别），
   本地进程模式读 ipc 内存里的输出缓冲（约 2000 行，ipc 退出即丢）。
7. 热更只验证了「dev server 起得来 + Electron 能加载它」；没有可视环境，没实际观察过改文件后的
   HMR 替换。`pnpm dev` 那套 8090/8091 与桌面端无关，桌面端 dev server 用 8092。
8. **登录态绑定 ipc 进程**：会话文件按「PID + 进程启动时间」命名，TTL 12 小时并在每次成功请求后续期，
   进程退出会主动吊销；重启应用需要重新登录（v1 刻意不做「记住我」）。
9. **`service.*` 不依赖 systemd 也能用**：单元未安装时由 ipc 托管 `chat-deepseek serve` 子进程
   （本地运行模式），停止/重启/日志都走这条路径；systemd 只是可选的「开机自启」增强。
   本地进程跟着 ipc 走——桌面端退出会停止服务；Windows/macOS 上 ipc 被强杀时没有 `Pdeathsig`，
   子进程可能残留（仅兜底路径，正常关闭会显式回收）。
10. **首次使用在 GUI 里创建第一个用户**：`auth.whoami` 返回 `initialized:false` 时，账户页显示创建表单，
    调 `auth.setup`；它只在没有活动 Owner 时可用，成功后直接建立登录态。没有 Owner 时 `serve` 会拒绝启动，
    服务页把「启动服务」换成「新建用户」并给出警告条，点击直接进账户页。
11. **GPU 崩溃自动退回软件合成**：没有 `/dev/dri`（容器、部分虚拟机）、上次 GPU 崩溃留下的标记、
    显式 `--disable-gpu` 三种情况都直接走软件合成。有 GPU 但驱动/沙箱不让用时，Chromium 会对 GPU 进程
    重试三次后以「GPU process isn't usable. Goodbye.」SIGTRAP 退出；主进程收到第一次
    `child-process-gone` 就写标记文件 `<userData>/gpu-software` 并干净退出（不做 `app.relaunch`，
    兜底子进程会抢单实例锁、窗口又不显示）。用户重新启动时标记生效，直接走软件合成，不会反复崩。
    想重新试硬件加速：`CHAT_DEEPSEEK_GPU=on` 启动一次（会清掉标记），或删掉那个文件。
11. **Wayland 窗口装饰**：Wayland 会话里装饰由 Chromium 自绘（灰底方角），不是 compositor 画的，
    与深色 UI 并置观感可以接受，不为此切平台。其它 compositor 与 Windows/macOS 未验证。
    `--smoke` 链路已在 Linux 上用真实的 `chat-deepseek` 二进制跑通（无窗口、临时 userData、退出码 0）。
