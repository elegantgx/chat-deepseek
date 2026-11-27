import { translate } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { callBridge } from './callbacks.js'
import { decodeBytes, encodeBytes } from './codec.js'
import { getShellRuntime } from './shell.js'
import type { ShellRuntime } from './shell.js'
import type {
  BridgeError,
  ChatShell,
  NetBody,
  NetRequestSpec,
  NetResponse,
  NetUploadFile,
  NetUploadSpec,
} from './types.js'

/**
 * 把 `fetch` 翻译成桥调用，目标是 `src/services/api/client.ts` 一行都不用改。
 *
 * 几个刻意的取舍：
 * - 只接管相对 `/api/...`；别的 URL 在读取请求体之前就回落到原始 fetch；
 * - HTTP 非 2xx 不抛错，构造真 `Response` 交给 client.ts 自己判断；
 * - 只有请求没到达服务端（network / no_server / protocol / busy / tls）才 reject；
 * - `Accept: text/event-stream` 走 netStream，`FormData` 走 netUpload；
 *   附件与 TTS 这类二进制响应走 netDownload（字节经 chunk 增量过来），
 *   其余走 netRequest。这些判据都在发请求之前确定，壳不需要再猜。
 */

/** 上传分片原文大小；与 §4.1 的 fileChunk ≤256 KiB 对齐 */
const FILE_CHUNK_BYTES = 256 * 1024

/** 单文件上限，与 `filestore.MaxFileSize` 对齐；下载同样按它兜底防爆内存 */
const MAX_FILE_BYTES = 64 * 1024 * 1024

/**
 * 上传可能远超普通请求的 120s（大文件 + 慢网络），但壳丢 `done` 时仍要有兜底：
 * 十分钟后回收，避免上传条目永远挂着。
 */
const UPLOAD_TIMEOUT_MS = 10 * 60_000

/** 浏览器 fetch 的原始实现；非 /api 请求回落到它 */
let fallbackFetch: typeof fetch | null = null

export const setFallbackFetch = (fetchImpl: typeof fetch): void => {
  fallbackFetch = fetchImpl
}

let tempFileSequence = 0
const nextTempFileId = (): string => `tmp${(tempFileSequence += 1)}`

const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError')

const isAbortError = (value: unknown): boolean =>
  (value instanceof DOMException && value.name === 'AbortError') ||
  (value instanceof Error && value.name === 'AbortError')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 把内部错误做成带 `code` 的 Error；桥的错误模型只认 `code`，文案在 errorMessage 里 */
const codedError = (code: string, message: string): Error => {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

const asBridgeError = (value: unknown): BridgeError => {
  if (isRecord(value) && typeof value.code === 'string') {
    return {
      code: value.code,
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
      ...(typeof value.status === 'number' ? { status: value.status } : {}),
      ...(typeof value.cause === 'string' ? { cause: value.cause } : {}),
      ...(typeof value.body === 'string' ? { body: value.body } : {}),
    }
  }
  if (isAbortError(value)) {
    return { code: 'aborted' }
  }
  return { code: 'protocol', message: value instanceof Error ? value.message : '桥返回了未知错误' }
}

/** 桥错误 → 浏览器 fetch 的失败形态；文案在 mobile i18n 里，不把实现码抛给用户 */
const toFetchError = (value: unknown): Error => {
  const error = asBridgeError(value)
  if (error.code === 'aborted') {
    return abortError()
  }
  return new Error(errorMessage(error))
}

const errorMessage = (error: BridgeError): string => {
  switch (error.code) {
    case 'no_server':
      return translate('mobileErrorNoServer')
    case 'network':
      return translate('mobileErrorNetwork')
    case 'busy':
      return translate('mobileErrorBusy')
    case 'unsupported':
      return translate('mobileErrorUnsupported')
    case 'protocol':
      return translate('mobileErrorProtocol')
    case 'tls':
      // 证书不受信任要能和普通断网区分开，页面才能给出不同的下一步。
      return translate('mobileErrorTls')
    case 'file_too_large':
      return translate('mobileErrorFileTooLarge')
    default:
      return error.message ?? translate('mobileErrorNetwork')
  }
}

const isApiPath = (url: string): boolean => url.startsWith('/api/')

const headersToRecord = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {}
  headers.forEach((value, name) => {
    record[name] = value
  })
  return record
}

const ensureContentType = (headers: Headers, value: string): void => {
  if (value && !headers.has('content-type')) {
    headers.set('content-type', value)
  }
}

type PreparedBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'bytes'; base64: string }
  | { kind: 'form'; form: FormData }

interface PreparedRequest {
  url: string
  method: string
  headers: Headers
  body: PreparedBody
  signal: AbortSignal | null
}

const prepareBody = async (
  body: BodyInit | null | undefined,
  headers: Headers
): Promise<PreparedBody> => {
  if (body === null || body === undefined) {
    return { kind: 'none' }
  }
  if (typeof body === 'string') {
    ensureContentType(headers, 'text/plain;charset=UTF-8')
    return { kind: 'text', text: body }
  }
  if (body instanceof URLSearchParams) {
    ensureContentType(headers, 'application/x-www-form-urlencoded;charset=UTF-8')
    return { kind: 'text', text: body.toString() }
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // multipart 的 boundary 由壳在 netUpload 里生成，渲染层不写 Content-Type。
    return { kind: 'form', form: body }
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    ensureContentType(headers, body.type)
    return { kind: 'bytes', base64: encodeBytes(new Uint8Array(await body.arrayBuffer())) }
  }
  if (body instanceof ArrayBuffer) {
    return { kind: 'bytes', base64: encodeBytes(new Uint8Array(body)) }
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    return {
      kind: 'bytes',
      base64: encodeBytes(
        new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)
      ),
    }
  }
  throw new Error(translate('mobileErrorProtocol'))
}

const prepareRequest = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<PreparedRequest> => {
  if (typeof input === 'string' || input instanceof URL) {
    const headers = new Headers(init?.headers)
    return {
      url: typeof input === 'string' ? input : input.href,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: await prepareBody(init?.body, headers),
      signal: init?.signal ?? null,
    }
  }
  const request = init ? new Request(input, init) : input.clone()
  const headers = new Headers(request.headers)
  // Request 的 body 只能读一次；clone 后按字节处理，语义上仍有 Content-Type 兜底。
  const body: BodyInit | null =
    init?.body !== undefined ? init.body : request.body ? await request.clone().arrayBuffer() : null
  return {
    url: request.url,
    method: request.method.toUpperCase(),
    headers,
    body: await prepareBody(body, headers),
    signal: request.signal,
  }
}

/**
 * 壳给的 `status` 必须是合法 HTTP 状态（200–599）。
 * 以前非法值会被钳成 200：401 伪装成成功、客户端不跳登录，问题更难查。
 */
const readStatus = (result: NetResponse): number => {
  const { status } = result
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) {
    throw codedError('protocol', `壳返回了非法 HTTP 状态：${String(status)}`)
  }
  return status
}

/** `statusText` 用壳给的值；缺了兜 `HTTP <status>`，错误提示里至少能看出状态码 */
const readStatusText = (result: NetResponse, status: number): string =>
  typeof result.statusText === 'string' && result.statusText.length > 0
    ? result.statusText
    : `HTTP ${status}`

const toResponse = (result: NetResponse): Response => {
  const status = readStatus(result)
  const headers = new Headers()
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    try {
      headers.append(name, value)
    } catch {
      // 非法头（壳 bug）跳过，不因为一个头把整个响应毁掉。
    }
  }
  const bytes = result.body ? decodeBytes(result.body) : new Uint8Array()
  // 204/205/304 按 fetch 规范不能带 body。
  const body = status === 204 || status === 205 || status === 304 ? null : streamFromBytes(bytes)
  return new Response(body, { status, statusText: readStatusText(result, status), headers })
}

const streamFromBytes = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length > 0) {
        controller.enqueue(bytes)
      }
      controller.close()
    },
  })

const httpFailureResponse = (error: BridgeError): Response | null => {
  if (error.code !== 'http' || typeof error.status !== 'number') {
    return null
  }
  try {
    return toResponse({
      status: error.status,
      statusText: '',
      headers: { 'content-type': 'application/json' },
      ...(typeof error.body === 'string' ? { body: error.body } : {}),
    })
  } catch {
    // 连状态都非法时按桥错误抛出，不再伪装成 HTTP 响应。
    return null
  }
}

/** netRequest / netUpload 共用的通道：HTTP 错误也返回 Response */
const callNet = async (call: Promise<NetResponse>): Promise<Response> => {
  try {
    return toResponse(await call)
  } catch (error) {
    const failure = asBridgeError(error)
    const response = httpFailureResponse(failure)
    if (response) {
      return response
    }
    throw toFetchError(failure)
  }
}

/** 把外层 AbortSignal 接到内部 controller；返回摘除函数 */
const linkAbort = (outer: AbortSignal | null, inner: AbortController): (() => void) => {
  if (!outer) {
    return () => {}
  }
  const forward = () => inner.abort()
  if (outer.aborted) {
    inner.abort()
  } else {
    outer.addEventListener('abort', forward, { once: true })
  }
  return () => {
    outer.removeEventListener('abort', forward)
  }
}

const requestResponse = async (
  runtime: ShellRuntime,
  request: PreparedRequest,
  spec: NetRequestSpec
): Promise<Response> => {
  const { shell } = runtime
  return callNet(
    callBridge<NetResponse>((id) => shell.netRequest(id, JSON.stringify(spec)), {
      ...(request.signal ? { signal: request.signal } : {}),
      abort: (id) => shell.abort(id),
    })
  )
}

/**
 * SSE：fetch 要在第一条 chunk 到达时就返回 Response，而不是等整个流结束。
 * 所以这里先挂一个 ReadableStream，收到首块时合成 200 + `text/event-stream` 的响应头；
 * 如果壳在首块之前就结束（4xx/5xx、空响应或网络错误），用 done 里的真实
 * status/headers/body 构造，让 client.ts 按浏览器语义自己分类。
 */
const streamResponse = (
  runtime: ShellRuntime,
  request: PreparedRequest,
  spec: NetRequestSpec
): Promise<Response> => {
  const { shell } = runtime
  const inner = new AbortController()
  const unlink = linkAbort(request.signal, inner)

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let cancelled = false
  let responded = false
  let resolveHead: ((response: Response) => void) | null = null
  let rejectHead: ((reason: unknown) => void) | null = null
  const head = new Promise<Response>((resolve, reject) => {
    resolveHead = resolve
    rejectHead = reject
  })
  const resolveWith = (response: Response) => {
    if (!resolveHead) {
      return
    }
    const resolve = resolveHead
    resolveHead = null
    rejectHead = null
    resolve(response)
  }
  const rejectWith = (reason: unknown) => {
    if (!rejectHead) {
      return
    }
    const reject = rejectHead
    resolveHead = null
    rejectHead = null
    reject(reason)
  }
  const closeBody = () => {
    if (!controller) {
      return
    }
    try {
      controller.close()
    } catch {
      // 消费者已经 cancel 或流已关闭。
    }
  }
  const errorBody = (error: unknown) => {
    if (!controller) {
      return
    }
    try {
      controller.error(error)
    } catch {
      // 流已经关闭；错误已通过 Promise 或 body 暴露。
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next
    },
    cancel() {
      cancelled = true
      inner.abort()
    },
  })

  const finish = (result: NetResponse) => {
    unlink()
    if (cancelled) {
      return
    }
    let status: number
    try {
      status = readStatus(result)
    } catch (error) {
      fail(error)
      return
    }
    if (!responded) {
      responded = true
      // 首块之前就结束：把 done 里真实的 status/headers/body 交给上层。
      // 200 但 content-type 不是 SSE（比如 JSON 错误）会按 protocol 报错；
      // 200 的 SSE 却一个字节都没有时客户端会按 interrupted 报错（可重试）。
      // 两条路都比「静默的空流」可区分，也都不会把失败伪装成成功。
      try {
        resolveWith(toResponse(result))
      } catch (error) {
        rejectWith(toFetchError(error))
        return
      }
      closeBody()
      return
    }
    if (status >= 400) {
      // 已经把 200 的响应头交给上层（SSE 首块即 resolve），此时只能用错误结束流。
      // 带上真实 status，上层才能按 401 跳登录页，而不是当成普通断流。
      errorBody(new ApiError('http', readStatusText(result, status), status))
      return
    }
    closeBody()
  }

  const fail = (error: unknown) => {
    unlink()
    if (cancelled) {
      return
    }
    const failure = asBridgeError(error)
    if (!responded) {
      responded = true
      const response = httpFailureResponse(failure)
      if (response) {
        resolveWith(response)
        closeBody()
        return
      }
      rejectWith(toFetchError(failure))
      closeBody()
      return
    }
    errorBody(toFetchError(failure))
  }

  void callBridge<NetResponse>((id) => shell.netStream(id, JSON.stringify(spec)), {
    signal: inner.signal,
    abort: (id) => shell.abort(id),
    onChunk: (bytes) => {
      if (cancelled || !controller) {
        return
      }
      if (!responded) {
        responded = true
        resolveWith(
          new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
        )
      }
      try {
        controller.enqueue(bytes)
      } catch {
        // 消费者已取消；callBridge 的 abort 会走 cancel()。
        cancelled = true
        inner.abort()
      }
    },
  }).then(finish, fail)

  return head
}

/**
 * 二进制下载（附件、TTS）：字节经 chunk 增量到 JS，拼成 `ReadableStream`。
 * 首块到达就 resolve，TTS 才能边下边播；`.blob()` 照常可用（流结束时收齐所有块）。
 *
 * 响应头要等 `done` 才有（§4.1 的信封只允许最后一条带 headers），所以首块合成的
 * 200 Response 没有 content-type；调用方本来就只需要字节，Blob 的 type 由附件元数据补。
 */
const downloadResponse = (
  runtime: ShellRuntime,
  request: PreparedRequest,
  spec: NetRequestSpec,
  download: NonNullable<ChatShell['netDownload']>
): Promise<Response> => {
  const { shell } = runtime
  const inner = new AbortController()
  const unlink = linkAbort(request.signal, inner)

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let cancelled = false
  let responded = false
  let received = 0
  let resolveHead: ((response: Response) => void) | null = null
  let rejectHead: ((reason: unknown) => void) | null = null
  const head = new Promise<Response>((resolve, reject) => {
    resolveHead = resolve
    rejectHead = reject
  })
  const resolveWith = (response: Response) => {
    if (!resolveHead) {
      return
    }
    const resolve = resolveHead
    resolveHead = null
    rejectHead = null
    resolve(response)
  }
  const rejectWith = (reason: unknown) => {
    if (!rejectHead) {
      return
    }
    const reject = rejectHead
    resolveHead = null
    rejectHead = null
    reject(reason)
  }
  const closeBody = () => {
    if (!controller) {
      return
    }
    try {
      controller.close()
    } catch {
      // 消费者已经 cancel 或流已关闭。
    }
  }
  const errorBody = (error: unknown) => {
    if (!controller) {
      return
    }
    try {
      controller.error(error)
    } catch {
      // 流已经关闭；错误已通过 Promise 或 body 暴露。
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next
    },
    cancel() {
      cancelled = true
      inner.abort()
    },
  })

  const finish = (result: NetResponse) => {
    unlink()
    if (cancelled) {
      return
    }
    let status: number
    try {
      status = readStatus(result)
    } catch (error) {
      fail(error)
      return
    }
    if (!responded) {
      responded = true
      // 没有任何字节（非 2xx、204、空文件）：用真实状态/头/正文构造响应。
      // 非 2xx 交给 client.ts 走 401 拦截与错误正文解析；200 空文件就是空 Blob。
      try {
        resolveWith(toResponse(result))
      } catch (error) {
        rejectWith(toFetchError(error))
        return
      }
      closeBody()
      return
    }
    if (status >= 400) {
      // 已经按 200 交给上层（首块即 resolve），只能把 4xx/5xx 写进流里。
      errorBody(new ApiError('http', readStatusText(result, status), status))
      return
    }
    closeBody()
  }

  const fail = (error: unknown) => {
    unlink()
    if (cancelled) {
      return
    }
    const failure = asBridgeError(error)
    if (!responded) {
      responded = true
      const response = httpFailureResponse(failure)
      if (response) {
        resolveWith(response)
        closeBody()
        return
      }
      rejectWith(toFetchError(failure))
      closeBody()
      return
    }
    errorBody(toFetchError(failure))
  }

  void callBridge<NetResponse>((id) => download(id, JSON.stringify(spec)), {
    signal: inner.signal,
    abort: (id) => shell.abort(id),
    onChunk: (bytes) => {
      if (cancelled) {
        return
      }
      received += bytes.length
      if (received > MAX_FILE_BYTES) {
        // 超过 filestore.MaxFileSize：立刻停壳并让流以协议错误结束，别把 WebView 堆撑爆。
        // 首块不可能就超限，但兜底 reject 一次，避免极端情况下 head 永远不 settle。
        const tooLarge = new ApiError('protocol', translate('mobileErrorFileTooLarge'))
        cancelled = true
        rejectWith(tooLarge)
        errorBody(tooLarge)
        inner.abort()
        return
      }
      if (!responded) {
        responded = true
        resolveWith(new Response(body, { status: 200 }))
      }
      try {
        controller?.enqueue(bytes)
      } catch {
        // 消费者已取消；callBridge 的 abort 会走 cancel()。
        cancelled = true
        inner.abort()
      }
    },
  }).then(finish, fail)

  return head
}

/** 上传取消/失败时清掉所有临时文件；壳不认识 tempId 时忽略即可，重复调用无副作用 */
const cleanupTempFiles = (shell: ChatShell, tempIds: string[]): void => {
  for (const tempId of tempIds) {
    try {
      shell.abort(tempId)
    } catch {
      // 壳可能只认识请求 id；清理失败不影响向用户报原始错误。
    }
  }
}

/** FormData → fileBegin/fileChunk/fileEnd + netUpload；临时文件在请求结束后由壳删除 */
const uploadForm = async (
  runtime: ShellRuntime,
  request: PreparedRequest,
  form: FormData
): Promise<Response> => {
  const { shell } = runtime
  const fields: Array<{ name: string; value: string }> = []
  const files: NetUploadFile[] = []
  const tempIds: string[] = []
  const signal = request.signal

  try {
    for (const [name, value] of form.entries()) {
      if (signal?.aborted) {
        throw abortError()
      }
      if (typeof value === 'string') {
        fields.push({ name, value })
        continue
      }
      if (value.size > MAX_FILE_BYTES) {
        // 先拒绝再 fileBegin：64 MiB 要 256 个分片，等写完 400 块才发现，
        // 临时文件和等待时间都已经白花了。
        throw codedError('file_too_large', translate('mobileErrorFileTooLarge'))
      }
      const tempId = nextTempFileId()
      tempIds.push(tempId)
      shell.fileBegin(
        tempId,
        JSON.stringify({
          name: value.name || 'blob',
          mime: value.type || 'application/octet-stream',
          size: value.size,
        })
      )
      await sendFileChunks(shell, tempId, value, signal)
      shell.fileEnd(tempId)
      files.push({
        field: name,
        name: value.name || 'blob',
        mime: value.type || 'application/octet-stream',
        size: value.size,
        tempId,
      })
    }

    if (signal?.aborted) {
      throw abortError()
    }
    const spec: NetUploadSpec = {
      serverId: runtime.ready.selectedId,
      method: request.method,
      url: request.url,
      headers: headersToRecord(request.headers),
      fields,
      files,
    }
    const response = await callNet(
      callBridge<NetResponse>((id) => shell.netUpload(id, JSON.stringify(spec)), {
        ...(signal ? { signal } : {}),
        abort: (id) => shell.abort(id),
        timeoutMs: UPLOAD_TIMEOUT_MS,
      })
    )
    if (!response.ok) {
      // HTTP 失败时壳本应自己删临时文件；再发一次 abort 是幂等的，防实现遗漏导致泄漏。
      cleanupTempFiles(shell, tempIds)
    }
    return response
  } catch (error) {
    // 取消、分块失败、netUpload reject、超时都走这里：清掉所有 tempId 再报错。
    cleanupTempFiles(shell, tempIds)
    if (isAbortError(error)) {
      throw error
    }
    if (error instanceof Error && !('code' in error)) {
      // callNet 已经转成带 i18n 文案的 fetch 错误，别再按协议错误包一层把文案盖掉。
      throw error
    }
    throw toFetchError(error)
  }
}

const sendFileChunks = async (
  shell: ChatShell,
  tempId: string,
  file: Blob,
  signal: AbortSignal | null
): Promise<void> => {
  for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) {
    if (signal?.aborted) {
      throw abortError()
    }
    const bytes = new Uint8Array(await file.slice(offset, offset + FILE_CHUNK_BYTES).arrayBuffer())
    if (signal?.aborted) {
      throw abortError()
    }
    shell.fileChunk(tempId, encodeBytes(bytes))
  }
}

const netBody = (body: PreparedBody): NetBody | undefined => {
  if (body.kind === 'text') {
    return { kind: 'text', text: body.text }
  }
  if (body.kind === 'bytes') {
    return { kind: 'bytes', base64: body.base64 }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 下载判定（全部在发请求之前完成，不能先收完再决定怎么读）
// ---------------------------------------------------------------------------

/** 附件下载：GET /api/v1/files/<id>（DELETE 同路径但方法不同，不会误判） */
const FILE_PATH_PREFIX = '/api/v1/files/'

/** TTS 返回裸 PCM 字节流，不能走整包 base64 */
const TTS_PATH = '/api/v1/speech/tts'

/**
 * Accept 头表明要二进制时也算下载；给以后新增的调用点留判据，
 * 不需要为了「别整包 base64」去改 `src/services/api/client.ts`。
 */
const BINARY_ACCEPT = /octet-stream|application\/(?:pdf|zip|x-7z-compressed)|image\/|audio\/|video\//i

const isDownloadRequest = (request: PreparedRequest): boolean => {
  const path = request.url.split('?')[0]
  if (request.method === 'GET' && path.startsWith(FILE_PATH_PREFIX)) {
    return true
  }
  if (path === TTS_PATH) {
    return true
  }
  return BINARY_ACCEPT.test(request.headers.get('accept') ?? '')
}

/** 替换 `globalThis.fetch` 的实现；只应由 mobile 入口在 mount 前安装 */
export const bridgeFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  // 先判 URL 再准备请求体：非 /api 请求（字体、data:、外链）没必要
  // clone().arrayBuffer() 把整个 body 完整读一遍再回落。
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!isApiPath(rawUrl)) {
    if (!fallbackFetch) {
      throw new TypeError(`bridgeFetch 没有原始 fetch 可回落：${rawUrl}`)
    }
    return fallbackFetch(input, init)
  }

  const request = await prepareRequest(input, init)
  const runtime = getShellRuntime()
  if (!runtime.ready.selectedId) {
    throw new Error(translate('mobileErrorNoServer'))
  }
  if (request.body.kind === 'form') {
    return uploadForm(runtime, request, request.body.form)
  }

  const spec: NetRequestSpec = {
    serverId: runtime.ready.selectedId,
    method: request.method,
    url: request.url,
    headers: headersToRecord(request.headers),
    ...(netBody(request.body) ? { body: netBody(request.body) } : {}),
  }
  // 老壳/浏览器 fake 可能还没实现 netDownload：退回 netRequest 让预览可用。
  // 真壳按新契约实现后，附件与 TTS 一定走分片下载，不再整包 base64。
  const download = runtime.shell.netDownload
  if (isDownloadRequest(request) && typeof download === 'function') {
    return downloadResponse(runtime, request, spec, download)
  }
  if ((request.headers.get('accept') ?? '').includes('text/event-stream')) {
    return streamResponse(runtime, request, spec)
  }
  return requestResponse(runtime, request, spec)
}
