# Android 实现架构

> 三份文档的分工：`docs/android-product.md` 说**做什么**，本文说**怎么搭**，`docs/android-visual.md` 说
> **怎么画**。示意与截图仍是视觉的唯一真源。
> 当前状态：**仍然没有产品代码**；形态已定到可开工。
> **上一版（Compose + gomobile + 进程内 ipc）已作废**，本文是现行方案；改动理由见 §2。

## 1. 决策表

| 决策           | 结论                                                                 | 状态               |
| -------------- | -------------------------------------------------------------------- | ------------------ |
| 目标平台       | 仅 Android，不规划 iOS                                               | 已定               |
| UI 形态        | **打包进 APK 的 mobile Web，WebView 渲染**；不做 Compose 重写         | 已定               |
| 壳             | Kotlin（application）：ipc、HTTP、平台能力、WebView 宿主             | 已定               |
| UI 代码位置    | `src/mobile/` 独立入口，复用 `src/services` 与消息/Markdown 组件      | 已定               |
| UI 构建        | `rspack.mobile.config.ts` → `dist-mobile/`，不混进浏览器包            | 已定               |
| ipc            | 复用 `docs/ipc.md` 的 wire；**独立子进程**，stdin/stdout NDJSON       | 已定               |
| ipc 的传输     | **不改 HTTP**；控制面只给壳，渲染层经 `host` 桥调用                   | 已定               |
| 本机服务       | `serve` 子进程，监听 `127.0.0.1`，由 ipc 按桌面同一套 process mode 管 | 已定               |
| 数据面         | 壳持有 OkHttp + 每服务器 CookieJar；渲染层经 `net` 桥取数             | 已定               |
| 渲染层网络权限 | **没有**。CSP + 请求拦截兜底，资产之外不出网                          | 已定               |
| 外链           | `shouldOverrideUrlLoading` → Custom Tabs，不在 WebView 里开           | 已定               |
| 明文流量       | 仅 `127.0.0.1` 放行；远程必须 https                                   | 已定               |
| 自签证书       | 不做「忽略证书」开关；v1 不导入 CA，只给可操作错误                     | 已定（后置）       |
| ABI            | 只出 `arm64-v8a`                                                     | 已定               |
| minSdk         | 26                                                                   | 已定               |
| 首版范围       | **36 屏全上**；36 屏之外的状态按 §5.1 补示意                         | 已定               |
| 英文           | 直译一套，v1 不追等宽对齐                                            | 已定               |
| 截图回归       | headless Chrome + CDP，**同一次运行内双渲染对比**，不锁版本            | 已定               |
| Go 进程        | 独立子进程（`jniLibs` + exec）                                        | 已定，待 spike 验证 |
| 前台服务       | 有在途流或本机服务需要常驻时才起                                      | 已定               |

## 2. 为什么从 Compose 改成 WebView

1. **视觉真源是 HTML/CSS**（`docs/android/mockups/`）。Web 实现与它同引擎、同单位，属于结构翻译；
   Compose 要把盒模型、字体度量、行高、阴影重新逼近一遍，像素对齐反而更难。
2. **聊天最贵的三块**——Markdown、KaTeX/Mermaid、SSE——`src/` 全是现成的。Compose 要重写，
   而且公式和图最终还得再套 WebView，等于两套渲染。
3. **验收闭环同引擎**：示意、实现、回归都在 Chromium 里，像素 diff 能当门禁；Compose 只能人眼对。

代价是壳层打磨（键盘、返回、安全区）和一条原生数据桥，见 §11。

## 3. 进程与三条通道

```
app 进程
  Kotlin 壳
    ├─ ipc 客户端 ──stdin/stdout NDJSON──▶ chat-deepseek ipc ──▶ serve（127.0.0.1）
    ├─ OkHttp（每服务器 CookieJar）──HTTP──▶ /api/v1（本机 / 远程）
    └─ WebView（assets，无网络）◀── host / net 桥 ── 渲染层
```

三条通道各归一段，不互相顶替：

1. **渲染层 ↔ 壳**：能力桥。`host`（ipc 控制面）、`net`（HTTP 数据面）、少量平台能力。
   渲染层没有环境权限：不直接连网、不直接碰 ipc。
2. **壳 ↔ ipc**：NDJSON over stdin/stdout，只给壳。wire 与桌面完全一致。
3. **壳 ↔ 数据面**：HTTP `/api/v1`。本机是 `http://127.0.0.1:<port>`，远程是 `https://…`。

### 3.1 为什么 ipc 不挂到 HTTP 上

- **pipe 是私有通道，HTTP 是环境权限**。NDJSON 在 pipe 上天然只有父进程能写；挂到回环端口就变成
  「能发请求就能调」，最后还得发明 token 把权限收回去，绕一圈回原点，还多开一个面。
- **分帧本身就是契约**。一行一个 JSON、按 id 匹配、写请求串行，这些是为 pipe 设计的；换 HTTP 就要
  重新定义「一次请求怎么对应多行响应、事件流怎么走」，那不是换传输，是分叉 `docs/ipc.md`。

### 3.2 为什么渲染层不直接连网

- **「本机服务已停止」要求 UI 不依赖服务端**。壳要能在 `serve` 没起时照样显示停止状态，就不能让
  页面来源跟在服务进程后面。
- **远程服务器是用户自己跑的旧版本**。不能要求他们升级来加 CORS；服务端 Cookie 是 `SameSite=Lax`
  且没有 CORS 头，跨源直连走不通。壳持有 HTTP 就没有跨源这回事。
- **安全面更小**：渲染层只有 assets，没有网络权限；远程 JS（万一）也出不去。

## 4. Kotlin 壳

- **启动顺序**：`Application` → 起 ipc 子进程（哪怕还没初始化）→ 载入 assets → 渲染层先问 `host`
  要「服务器列表 / 本机状态」。`serve` 只在用户点启动后由 ipc 拉起。这个顺序不能反，否则首启空白。
- **ipc 客户端**：单 writer、单 reader 协程；同一类方法串行，按 `id` 匹配；一行 ≤ 1 MiB。
  实现 `HostClient` 同形的接口（`request(method, params)` / `onEvent`），与
  `desktop/renderer/app/host.tsx` 对齐。
- **net 客户端**：OkHttp，每个服务器一份 `CookieJar`（Keystore 包裹持久化）；CSRF 仍由渲染层
  在内存里持有，`net` 原样带 `X-CSRF-Token`。切换服务器时清空目标会话并重载渲染层，避免内存态
  串服务器。
- **平台**：前台服务与通知、麦克风/相机权限、文件选择、分享、返回手势、安全区。
- **渲染层隔离**：只放行 assets；`WebSettings` 关文件访问与通用访问；CSP 写
  `connect-src 'none'`；`addJavascriptInterface` 只在 assets 页面注入，别的来源不注。
- **端口与能力**：本机端口只从 `service.status.listen` 取，不写死；服务器类型与可用的管理
  方法由壳投影给渲染层，远程不注册管理能力（不是灰掉，是拿不到）。
- **双登录态**：本机管理走 ipc `auth.*`，聊天走 `/api/v1`；壳在本机登录成功时同时建立两者。
  ipc 会话过期的重登录屏不在示意里，属于 §5.1 缺状态。

### 4.1 桥的线格式

`addJavascriptInterface` 只能传字符串，所以桥是「同步调用 + 异步回调」，不用 `@JavascriptInterface`
返回值送结果：

```ts
// 注入到 assets 页面，名字固定；除 assets 外不注入
interface ChatShell {
  ready(): string // 同步返回 JSON：启动上下文
  host(id: string, method: string, paramsJson: string): void
  netRequest(id: string, specJson: string): void
  netStream(id: string, specJson: string): void
  netDownload(id: string, specJson: string): void
  netUpload(id: string, specJson: string): void
  platform(id: string, method: string, paramsJson: string): void
  abort(id: string): void
  fileBegin(id: string, metaJson: string): void // 附件分块上传：开临时文件
  fileChunk(tempId: string, base64: string): void // 同步，按 ≤256 KiB 原文分片
  fileEnd(tempId: string): void
}

// Kotlin → JS 只有一个对象，回调名固定
interface ChatBridge {
  done(id: string, envelopeJson: string): void // {ok:true,result} | {ok:false,error}
  chunk(id: string, base64: string): void // netStream / netDownload 共用
  event(envelopeJson: string): void // {method,params}：ipc 事件（服务状态、日志、备份进度）
}
```

- **`id` 由渲染层生成**，壳视为不透明字符串。`abort(id)` 对 ipc 请求是「不要结果了」，
  对 `netStream`/`netUpload` 是真正取消；`done` 每个 `id` 最多一次，且一定是最后一条。
- **壳本地方法走同一个 `host` 通道，前缀 `shell.`**：`shell.servers.list/add/remove/select/probe`。
  ipc 方法名不带前缀，两者不会撞车；渲染层不需要知道某个方法是被代理还是壳自己答的。
  - `probe` 在加入之前探一次可达性，结果要能区分 `tls`（证书不受信任）与 `network`/`http`，
    分别对应「证书不受信任」屏和普通失败屏。
  - `remove` 拒绝 `kind=local`；`add` 只收 `https://`、去掉尾部斜杠、按 baseUrl 去重。
  - `select` 只负责持久化选择，切换后由渲染层重载页面；壳必须 abort 在途 stream/upload。
- **`ready()` 是同步的**：渲染层先画启动屏再调它，壳最多在桥线程等 1.2s 做首次 ipc 投影，
  之后读缓存；不能占 UI 线程，也不能让首帧跟着 ipc 一起卡。
- **并发上限**：同时在途的 `netStream` 最多 4 个、`netUpload` 最多 1 个，超了返回
  `{code:'busy'}`，不排队（排队会让「停止生成」变慢）。
- **线程**：`@JavascriptInterface` 在 WebView 的桥线程被调，允许阻塞；壳不得在桥线程碰 View，
  回调统一经 UI 线程 `evaluateJavascript`。`fileChunk` 是同步的，一次写盘 256 KiB，不攒大缓冲。
- **转义**：回调参数用 `JSONObject.quote` 生成 JSON 字符串字面量；base64 只含 `[A-Za-z0-9+/=]`。
- **分片**：一条 `chunk` 原文 ≤ 32 KiB；壳按帧聚合，渲染层不自己节流。JS 侧收到超长分片要
  **切成多条投递，不许截断丢字节**（SSE 少一段的表现是「回答突然断了」，没有错误提示）。
- **两个方向都要分块**：`netStream` 和 `netDownload` 共用 `chunk`；下载（附件、TTS 音频）
  **不走 `netRequest` 的整包 base64**——64 MiB 附件会变成 85 MiB 字符串、`atob` 再拷一份，
  中端机 WebView 堆直接爆。
- **`netStream` 的约束**：非 2xx 一律不发 `chunk`，用 `done` 带真实 `status`；首块前校验
  `content-type` 是 `text/event-stream`，不是就走 `done`（别让「200 但返回 JSON」伪装成空 SSE）。
  已经发过 `chunk` 之后再来 4xx/5xx，要用带 `status` 的错误结束，渲染层据此跳登录页。
- **信封**：`done` 里带 `{status, statusText, headers}`；`headers` 是普通对象，**不保证重复头**，
  渲染层不要依赖 `Set-Cookie`（壳已经在 CookieJar 里拿走了）。
- **临时文件**：`abort(id)` 对 `tempId` 也必须删文件；`netUpload` 失败/取消同样清。壳收到未知
  `id` 可忽略，收到 `tempId` 必须删——否则反复取消能把缓存撑满。
- **错误只有 code，没有文案**：`network` / `http` / `protocol` / `busy` / `unsupported` / `no_server` / `tls`，
  文案在渲染层 i18n。`http` 带 `status`，`network` 带原始异常类型名（不带给用户看的英文），
  `tls` 单独一类——「证书不受信任」要能给出和「连不上」不同的下一步。
- **`ready()`** 返回 `{version, dataDir, theme, locale, capabilities, servers:[{id,kind,name,mode,baseUrl}], selectedId}`；
  `kind` 是 `local|remote`，`mode` 是 `installed|uninitialized|stopped`，远程固定 `installed`
  （连通性由数据面请求表达，不当成服务器状态）。端口不在这里，见 §4 的「端口与能力」。
  `capabilities` 形状：`{ipc:{available,version,methods}, platform:[...], limits:{streamConcurrency,
  uploadConcurrency,maxUploadBytes,maxDownloadBytes,maxStreamChunkBytes,maxFileChunkBytes}}`；
  渲染层按 `limits` 做预检，不写死数字。
- **`platform` 只放壳独有的**：`pickFiles`、`share`、`openExternal`、`requestPermission`、
  `notify`、`setKeepScreenOn`、`saveFile`。剪贴板走 Web API；下载走 `netDownload`，不从
  `platform` 绕。
- **页面原生文件输入**：`<input type=file>` 由 `WebChromeClient.onShowFileChooser` 接
  `ACTION_OPEN_DOCUMENT`（仅 assets 页面），选中的 content Uri 直接交回页面，不复制、不产生
  tempId——和 `platform.pickFiles` 的临时文件通道是两条路，各自服务不同调用点。
- **`saveFile`**：参数 `{name,mime,tempId}`，调用即接管该临时文件；`CreateDocument` 选保存
  位置后流式复制，成功 `{ok:true}`，取消/复制失败 `protocol`，打不开对话框 `unsupported`，
  已有保存在途 `busy`。成功、取消、失败、Activity 销毁都会删临时文件。
- **导出下载的拦截**：壳声明 `saveFile` 时，渲染层把「`<a download>` + `blob:`」的 click 改成
  256 KiB 分片 `fileBegin/fileChunk/fileEnd` + `saveFile`；完成后派发
  `window` 事件 `chatbridge:file-saved`（`detail: {ok, reason?}`），由外壳统一 toast。
  失败/取消路径 `abort(tempId)` 清临时文件。

## 5. 渲染层（mobile Web）

```
src/mobile/
  main.tsx          入口；装配 bridge、主题、路由
  app/              壳、导航、抽屉、二级页栈
  screens/          36 屏，一屏一文件
  ui/               从 mockup.css 搬来的 token 与组件
  scenario/         fake host + fake net：固定数据、固定延迟、固定错误
  bridge/           host / net 客户端与错误映射
```

- **复用**：`src/services/*`（chat store、SSE、branches、drafts、i18n、api client）、
  `src/components/{messages,markdown,chatInput}` 的内部逻辑。
- **重做**：桌面外壳（`src/app/App.tsx` 是桌面布局）、抽屉、设置栈、36 屏的布局与样式。
- **独立构建**：`rspack.mobile.config.ts` 输出 `dist-mobile/`，只进 APK；浏览器仍用 `dist/`。
- **fake 是硬需求**：截图回归、浏览器预览、无后端调试都靠 `scenario/`，
  等价于桌面 `app/mock-host.ts` 的位置。数据必须可复现（固定时间、固定文案、固定延迟）。
- **屏的注册**：分组开发时每组只写 `src/mobile/screens/<组>/`，用 `index.ts` 导出一份
  `Partial<ScreenRegistry>`；`registry.ts` 由 root 汇总，避免多个 agent 抢同一个文件。
- **文案的落脚**：并行期组内文案写 `strings.ts`，经 `screens/strings.ts` 的 `useStrings` 取，
  key 以 zh 为准、en 必须同 key。首版保留了这层脚手架（`screens/<group>/strings.ts`）：
  中英双语完整、类型对齐，但没有并进 `src/i18n/{zh,en}.ts`；迁移是机械工作，列为后续，
  迁移前新增文案仍要 zh/en 两边同步。

### 5.1 补出来的状态屏

36 屏只画了稳定态，实现一定需要的过场与异常态已经补齐（清单见 `docs/android-visual.md` §7.1），
共 20 屏，都在 `docs/android/mockups/screens/`，标题不带编号——它们是某屏的另一个状态，
不是新路由。原语统一加在 `mockup.css` 末尾的「§5.1 缺状态的原语」段。

- 本机：`server-starting`、`server-stopping`、`server-initializing-back`、`server-failed-second`、
  `session-expired`
- 备份/数据：`server-backup-creating`、`server-backup-deleting`、`server-backup-restoring`、
  `data-exporting`、`data-importing`、`data-import-failed`
- 远程：`server-remote-connecting`、`server-remote-cert`
- 空态：`empty-accounts`、`empty-backups`、`empty-drawer`
- 网络/上传：`net-offline`、`net-reconnecting`、`upload-progress`、`upload-failed`

规矩不变：**再出现缺的状态，先补示意再写代码**，不要就地发明。

## 6. 数据面契约

`net` 只暴露 fetch 需要的那几件事，渲染层不改业务写法：

- `request(spec)`：方法、路径、头、体；返回状态、头、字节。非流式响应（JSON、附件）走它。
- `stream(spec)`：SSE 用；原生按动画帧批量送字节（§4.1 的 `chunk`），JS 侧合成 `ReadableStream`。
- `download(spec)`：附件、TTS 等二进制响应用；同样走 `chunk`，JS 侧增量拼成 `Blob`，
  **不走 `request` 的整包 base64**。单条分片 ≤ 32 KiB，总量按 `MaxFileSize` 限制。
- `upload(spec)`：`FormData` 拆成字段 + 文件；文件先经 `fileBegin/fileChunk/fileEnd` 落到临时文件，
  再由 OkHttp 以 multipart 流式发出。单文件上限沿用 `filestore.MaxFileSize`（64 MiB），
  不一次性 base64 过桥；临时文件在请求结束（成功、失败、取消）后删掉。
- `abort(id)`：停止生成、取消上传/下载。
- **未选服务器**：返回可操作错误（「还没选择服务器」），不能伪装成网络失败。
- **错误映射**：原生异常映射成 `ApiError` 的 `network` / `http` / `protocol` 三类，
  文案走 `src/mobile` 的 i18n，和浏览器行为一致。
- **CSRF / Cookie**：Cookie 只在壳里；CSRF 只在渲染层内存里。登出、切换服务器都要两边一起清。

## 7. 生命周期

- **前台服务**：只在「有在途流」或「本机服务需要常驻」时启动，通知写明在做什么；
  不要在 App 启动就常驻通知。
- **进程被杀**：启动即向 ipc 拉 `service.status`、`backup.list`、`auth.whoami` 重新投影；
  UI 只画最后一次已知 + 加载态，不缓存权威状态。
- **切后台**：SSE 在壳里继续收，分片缓冲；回前台补投。WebView 被冻结也不断流。
- **息屏 / Doze**：壳负责超时与退避重连；恢复后以服务端为准补拉。
- **本机服务停止**：监控的是 ipc 的 `service.status`，不是端口探测。

## 8. 构建与 CI

- Gradle（Kotlin DSL），AGP 8.7.3 / Kotlin 2.0.21 / Gradle 8.10.2，`compileSdk 35`、
  `minSdk 26`、Java+Kotlin target 17，只出 `arm64-v8a`。**不提交 wrapper**：
  CI 用 `gradle/actions/setup-gradle` 钉版本，本地用 sdkman 那份。
- Go 产物：`GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w"`。
  已在本机实测：产物是 PIE ELF、interpreter 为 `/system/bin/linker64`，不需要再手动
  `-buildmode=pie`。以 `jniLibs/arm64-v8a/libchatd.so` 打包、`android:extractNativeLibs="true"`、
  从 `nativeLibraryDir` 执行。**不引入 gomobile / NDK**。
- 前端：`pnpm build:mobile` → `dist-mobile/`，由 Gradle 任务同步进 assets；
  `dist-mobile/` 不存在时构建出一个 spike 页，保证空仓库也能出包。
- GitHub Actions：手动触发（与桌面发布一致），`assembleDebug`，上传 APK artifact；
  debug 包自带签名，可直接装机。需要 JDK 17/21、Android SDK（`platforms;android-35`、
  `build-tools;35.0.0`）、`fonts-noto-cjk`（截图用）。**不锁 Chrome 版本**。
- 本地没有 Android SDK/adb/gradle 时装包验证只能走 CI；本地能跑 Web、Go、截图。
  本机现在有 JDK 21 + Gradle 8.10.2（sdkman）和一份 SDK 在 `.android-sdk/`（不进版本库），
  用 `android/local.properties` 的 `sdk.dir` 指过去，不设全局环境变量；
  `GRADLE_USER_HOME` 也指到 `tmp/`，免得往家目录写缓存。

## 9. 截图与验收

- **不锁 Chromium**：CI 里用同一个 Chrome，把示意页与实现页各截一张，互相比；仓库里的
  `docs/android/mockups/shots/` 只作为人看的参考，不作为 CI 基线，版本漂移自动抵消。
- 通过 CDP 控制（经 `--remote-debugging-port`）：390×844、`deviceScaleFactor 2`、
  `prefers-color-scheme` 明暗两轮、`prefers-reduced-motion: reduce` 冻结动画；
  `scripts/shots.mjs` 负责双渲染、diff、报告（`tmp/shots/report.json` + 并排/差异图）。
- 判定口径：单通道差 ≤8 忽略 → 叠 1px 邻域容差放过抗锯齿 → 差异掩码腐蚀 1px 后仍有像素算
  「成片差异」；两图内容包围盒位置/宽高偏差 >1px 算结构漂移；尺寸不是 780×1688 直接失败。
  阈值 `--max-diff`，首版 0.5% 起步。
- **系统状态栏不参与比对**：示意页顶部画了一段 28px 的假状态栏（9:41 + 信号/WiFi/电池）
  供人看；实现页跑在 WebView 里，真机那 28px 由系统绘制、不归页面。截实现页时用
  `Emulation.setSafeAreaInsetsOverride` 把 `env(safe-area-inset-top)` 模拟成 28px，比对时
  再忽略顶部 28 CSS px（`--ignore-top=28`，默认值），两图仍须同为 780×1688。这样比的是
  「状态栏以下的 App 内容」，谁画状态栏都不影响基线。Chrome 不支持该 CDP 命令时报告记
  `safeAreaOverride: 'unsupported'` 并显式警告，不静默降级。
- **成片差异按比例容忍**：WebView 原生密码点（`•` vs 示意的 `●`）、`system-ui` 与
  示意 UA 字体的 1px 基线差、真实数据文案，会在「像素完全对齐」的屏上留下成片差异；
  默认 `--max-solid=0.25%` 才判失败，`0` 回到「任何成片像素都失败」的严格口径。
  结构错误仍由内容包围盒和更大的成片区域抓。
- **零差异时跳过包围盒**：`diffPixels === 0`（在通道容差内完全相同）时不再用 bbox 判漂移；
  弹窗遮罩下左上角背景色的启发式会误报，实测 7 屏均属此类。
- **屏级豁免**必须写原因，放在 `scripts/shots/registry.mjs` 的 `SCREEN_ALLOWANCES`：
  `chat-drawer` 只判抽屉本身（背后是真实会话的滚动位置，不是示意里的装饰页）；
  `server-preparing` 放宽到 5%（示意把禁用主按钮画成灰底，与 visual §5「保留品牌色 45%，
  不要灰底」冲突，实现按规范）。豁免会写进报告，不允许无声放过。
- **自检**：`node scripts/shots.mjs --mockup-as-impl` 是「示意 vs 示意」，必须 0.00%——
  渲染链路不稳就等于没基线。已实测 36 屏全 0.00%，且与仓库既有截图逐字节一致。
- `skipped` 不算失败（示意或实现缺失时跳过），但 CI 要先 `pnpm build:mobile` 并检查跳过清单，
  否则「全是占位」也会绿。
- **首版验收通过后，以该版本截图作为后续基线**，不再逐像素追示意；示意降为「设计意图」。
- 英文直译；英文换行导致的差异不计入失败。
- CI 需要 `fonts-noto-cjk`（缺了中文是方框，diff 可能仍然稳定，但人看不了）。
- 目前只回归 registry 里的 36 屏；§5.1 的 20 个状态屏要靠 fake 场景单独出图，
  等状态实现落地后再扩映射，别急着把它塞进 36 屏清单。

## 10. Go 侧改动（预计，spike 确认）

1. **Android 构建**：确认 `GOOS=android` 下 `//go:build linux` 的 `configureLocalProcess`
   （`Pdeathsig`）能编译、能生效；不行就加 `!android` 分支。
2. **会话文件路径**：`sessionRootCandidates` 的 `android` 分支目前会落到 `os.UserCacheDir()`；
   改成由壳传入的 app 私有目录，语义（TTL、滑动续期、归属进程）不变。
3. **`service.install/uninstall`**：Android 上返回 `unsupported`，并从 `capabilities.methods`
   裁剪；客户端按能力表渲染，不假设方法一定存在。
4. **数据目录**：由壳传 `--data-dir`，不依赖二进制同级目录。
5. 其余复用：process mode 的 `start/stop/logs`、`auth.*`、`account.*`、`backup.*` 不改。

## 11. 风险

1. **exec 从 `jniLibs` 执行**：PIE、`extractNativeLibs`、Android 10+ 的 W^X、国产 ROM 差异；
   spike A 不通就退回 gomobile（代价是 NDK + 进程内崩溃面）。
2. **子进程保活**：LMK 与前台服务策略；被杀了要能重新拉起并重新握手。
3. **桥的吞吐**：SSE 逐帧批量、上传分块；不批量会把主线程打满。
4. **WebView 版本下限**：`src/` 有 `:has` / `dvh`（Chromium 105/108+），老 ROM 降级要验证。
5. **两套 transport 漂移**：浏览器 fetch 与原生 net 用同一套 client 用例 + fake native 跑一遍。
6. **本机双会话**：`/api/v1` 与 ipc 登录态可能不同步，过期重登录屏待补。
7. **360dp / 字号 1.3×**：示意按 390dp 中文画；压缩规则未定，先按容差放过。
8. **APK 体积**：Go 二进制 + assets；只出 arm64 已砍一半。

## 12. 开工顺序与子 agent 切分

顺序的道理：**ipc 与 net 一通，剩下的就是「复刻 + 绑定」**。所以 36 屏一起做反而比挑几屏省——
壳、桥、fake、截图管线只需要对齐一次；挑几屏做反而要维护两套临时状态。

1. 文档（本文）：定死形态与边界。
2. **spike A**：子进程 exec + 最小 APK（CI 出包，真机装）——先定生死。
3. 壳骨架 + ipc 客户端 + net 桥；登录、发一条、SSE 跑通。
4. mobile Web 壳 + token + 36 屏；按文件所有权并行，`scenario` 与 `bridge` 先落地。
5. 截图 harness（`scripts/shots.mjs`）+ CI。
6. 英文直译；真机验收。

并行时的文件所有权（互不重叠，root 只做接口与验收）：

| 工作              | 所有权                                                               |
| ----------------- | -------------------------------------------------------------------- |
| Go/构建/CI        | `internal/ipc/*`（android 适配）、`android/` 构建脚本与清单、`.github/workflows/android.yml`、`.gitignore` |
| 壳 ipc/net/桥     | `android/app/src/main/**/{ipc,net,platform,web}/`                    |
| MainActivity 接线 | root（`MainActivity.kt` 单独归 root，避免两个 agent 抢同一个文件）    |
| mobile 外壳/主题  | `src/mobile/app/`、`src/mobile/ui/`、`src/mobile/bridge/`、`src/mobile/scenario/`、`rspack.mobile.config.ts` |
| 36 屏 + 缺状态屏  | `src/mobile/screens/<组>/`（服务器、账户、聊天、设置分组各自独占）     |
| 缺状态示意        | `docs/android/mockups/mockup.css`（只追加）、`screens/` 新文件、新截图 |
| 截图回归          | `scripts/shots.mjs`、`docs/android/mockups/`（只读）                  |
| 文案              | `src/mobile/i18n/` 与 `src/i18n/{zh,en}.ts` 的 key 增补               |
