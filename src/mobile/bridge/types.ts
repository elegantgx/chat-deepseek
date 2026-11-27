/**
 * Kotlin 壳 ↔ mobile Web 的线格式。
 *
 * 这张表是 `docs/android-architecture.md` §4.1 与 §6 的 JS 侧落点：
 * - `ChatShell` 由壳注入到 `window.ChatShell`，方法都是「同步调用 + 异步回调」；
 * - `ChatBridge` 由渲染层注册成 `window.__chatBridge`，壳只往这里回调；
 * - `id` 由渲染层生成、壳视为不透明字符串；每个 id 最多一条 `done`，且一定是最后一条。
 *
 * 除 `docs/android-architecture.md` 已写死的字段外，下面 `net*` 的 spec/结果形状是
 * 本文档之外必须与壳对齐的补充契约（文档只说了「返回状态、头、字节」）。改这里要同步改壳。
 */

/** 渲染层实际使用的语言标签，与 `src/services/settings.ts` 的 Locale 一致 */
export type ShellLocale = 'zh-CN' | 'en-US'

/** 主题偏好；`system` 由渲染层结合 `prefers-color-scheme` 解析成 light/dark */
export type ShellTheme = 'light' | 'dark' | 'system'

/** 服务器类型：本机走 ipc 管理，远程只登录 + 聊天 */
export type ShellServerKind = 'local' | 'remote'

/**
 * 本机三态；远程服务器目前复用 `installed` 表示可达。
 * 端口不在这里，必须从 `system.status` / `service.status` 的 `listen` 取。
 */
export type ShellServerMode = 'installed' | 'uninitialized' | 'stopped'

export interface ShellServer {
  id: string
  kind: ShellServerKind
  name: string
  mode: ShellServerMode
  baseUrl: string
}

/** `ready()` 里的能力投影；方法表与壳实际注册的方法同源 */
export interface ShellCapabilities {
  methods: string[]
  ipcVersion?: number
  features?: Record<string, boolean>
}

/** `ChatShell.ready()` 同步返回的启动上下文（JSON 解析后的形状） */
export interface ShellReady {
  version: string
  dataDir: string
  theme: ShellTheme
  locale: ShellLocale
  capabilities: ShellCapabilities
  servers: ShellServer[]
  selectedId: string | null
}

/**
 * 桥的错误码。
 *
 * `network`/`http`/`protocol`/`busy`/`unsupported`/`no_server` 来自 §4.1；
 * `aborted` 是渲染层取消后自己产生的，不会从壳传回来。
 * 控制面（`host`）沿用 `docs/ipc.md` 的错误码（`bad_request`、`unavailable`……），
 * 所以 `BridgeError.code` 的类型是 string，而不是只允许下面这几个。
 */
export type BridgeErrorCode =
  | 'network'
  | 'http'
  | 'protocol'
  | 'busy'
  | 'unsupported'
  | 'no_server'
  /** 证书不受信任；要和「连不上」区分开，页面上给不同的下一步 */
  | 'tls'
  | 'aborted'

export interface BridgeError {
  code: string
  /** 诊断用，不保证稳定；用户文案在渲染层 i18n 里 */
  message?: string
  /** 仅 `http`：HTTP 状态码 */
  status?: number
  /** 仅 `network`：原始异常类型名（如 `ECONNREFUSED`），不带给用户看 */
  cause?: string
  /** 仅 `http`：响应体（base64），让渲染层能像浏览器一样解析错误 JSON */
  body?: string
}

/** `done` 的回调信封；`result` 的形状由具体方法决定 */
export type BridgeEnvelope = { ok: true; result: unknown } | { ok: false; error: BridgeError }

/** 壳注入的同步接口；字段与方法名是契约，不要改名 */
export interface ChatShell {
  /** 同步返回 `ShellReady` 的 JSON 字符串 */
  ready(): string
  host(id: string, method: string, paramsJson: string): void
  /** 非流式请求；HTTP 非 2xx 也走 `{ok:true,result:{status,...}}`，不要当桥错误 */
  netRequest(id: string, specJson: string): void
  /** SSE；HTTP 非 2xx 时不要发 chunk，把 status/body 放进 done，JS 才能构造错误 Response */
  netStream(id: string, specJson: string): void
  /**
   * 二进制下载（附件、TTS）；成功时字节走 `chunk`，`done` 只带 status/headers。
   * 不要用 netRequest 整包 base64：64 MiB 附件会在 WebView 里瞬间多出上百 MB 字符串。
   * 真壳必须实现；浏览器 fake 还没补时桥会退回 netRequest，保证预览可用。
   */
  netDownload?(id: string, specJson: string): void
  netUpload(id: string, specJson: string): void
  platform(id: string, method: string, paramsJson: string): void
  /**
   * 取消请求/流。渲染层在分块上传中断时也可能传 fileBegin 的 tempId 请壳清理临时文件；
   * 壳不认识这种 id 时忽略即可（netUpload 正常结束后仍由壳删临时文件）。
   */
  abort(id: string): void
  /** 附件分块上传：开临时文件。`id` 就是后续 fileChunk/fileEnd 的 tempId */
  fileBegin(id: string, metaJson: string): void
  /** 同步写入一块原文（≤256 KiB 的 base64），不攒大缓冲 */
  fileChunk(tempId: string, base64: string): void
  fileEnd(tempId: string): void
}

/** 渲染层注册到 `window.__chatBridge` 的回调对象 */
export interface ChatBridge {
  done(id: string, envelopeJson: string): void
  /** 只有 netStream / netDownload 使用；一条 chunk 的原文 ≤32 KiB（超长会被 JS 切条投递） */
  chunk(id: string, base64: string): void
  /** ipc 事件（服务状态、日志、备份进度），`{method, params}` 的 JSON */
  event(envelopeJson: string): void
}

// ---------------------------------------------------------------------------
// net 数据面（§6）：渲染层把 fetch 需要的东西投影成这几份 JSON
// ---------------------------------------------------------------------------

/**
 * 请求体。字符串 / URLSearchParams / Blob / ArrayBuffer 都归一成 text 或 bytes；
 * `FormData` 不进这里，走 netUpload + fileBegin/fileChunk/fileEnd。
 */
export type NetBody = { kind: 'text'; text: string } | { kind: 'bytes'; base64: string }

/**
 * 一次非流式请求。`url` 保持 `/api/v1/...` 原样，由壳决定拼本机还是远程的 origin。
 * `serverId` 取 `ready().selectedId`；为 null 时壳应按当前选中服务器处理，
 * 没有选中就回 `no_server`，不要伪装成网络失败。
 */
export interface NetRequestSpec {
  serverId: string | null
  method: string
  url: string
  headers: Record<string, string>
  body?: NetBody
}

export interface NetUploadFile {
  /** multipart 字段名 */
  field: string
  name: string
  mime: string
  size: number
  /** 已经通过 fileBegin/fileChunk/fileEnd 落好的临时文件 id */
  tempId: string
}

/** FormData 上传：普通字段 + 已落到临时文件的附件 */
export interface NetUploadSpec {
  serverId: string | null
  method: string
  url: string
  headers: Record<string, string>
  fields: Array<{ name: string; value: string }>
  files: NetUploadFile[]
}

/**
 * netRequest / netStream / netDownload 的 `done` 结果。
 *
 * 重要：HTTP 非 2xx **不是**桥错误，和浏览器 fetch 一样照常返回 `status`/`body`，
 * 由 `src/services/api/client.ts` 决定怎么报错。只有请求没到达服务端（network）、
 * 协议坏了（protocol）、并发超限（busy）等才走 `{ok:false,error}`。
 *
 * 流式调用的 2xx 响应不带 `body`：字节已经通过 `chunk` 增量投递；非 2xx（或
 * 首块之前就结束的响应）用这里的 `body` 让渲染层能读到错误正文。
 */
export interface NetResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  /**
   * 完整响应体的 base64。netRequest 一定有（可为空串）；
   * netStream / netDownload 只在「没有走 chunk」的响应上带（非 2xx、空响应）。
   */
  body?: string
}

/** fileBegin 的元信息；壳据此建临时文件 */
export interface UploadMeta {
  name: string
  mime: string
  size: number
}

// ---------------------------------------------------------------------------
// platform：只放壳独有的能力；剪贴板、下载不走这里（§4.1）
// ---------------------------------------------------------------------------

export type PlatformMethod =
  | 'pickFiles'
  | 'share'
  | 'openExternal'
  | 'requestPermission'
  | 'notify'
  | 'setKeepScreenOn'

export interface PickFilesParams {
  multiple?: boolean
  /** MIME 或扩展名过滤，如 `image/*`、`.pdf` */
  accept?: string
}

/** 选好的文件已经落在壳的临时文件里，tempId 可交给 netUpload 使用 */
export interface PickedFile {
  name: string
  mime: string
  size: number
  tempId: string
}

export interface PickFilesResult {
  files: PickedFile[]
}

export interface ShareParams {
  title?: string
  text?: string
  url?: string
}

export interface OpenExternalParams {
  url: string
}

export type PermissionName = 'microphone' | 'camera' | 'notifications'

export interface RequestPermissionParams {
  permission: PermissionName
}

export interface PermissionResult {
  granted: boolean
}

export interface NotifyParams {
  title: string
  body: string
}

export interface KeepScreenOnParams {
  enabled: boolean
}

declare global {
  interface Window {
    /** 壳在 assets 页面注入；浏览器预览时不存在 */
    ChatShell?: ChatShell
    /** 渲染层在启动时注册；壳按名字回调 */
    __chatBridge?: ChatBridge
  }
}
