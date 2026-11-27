import { decodeTextBase64, encodeTextBase64 } from '../bridge/codec.js'
import type { NetRequestSpec, NetResponse, NetUploadSpec, UploadMeta } from '../bridge/types.js'
import {
  FIXED_PNG_BASE64,
  FIXED_SESSION_EXPIRES,
  FIXED_SSE_EVENTS,
  FIXED_UPDATED_AT,
} from './fixtures.js'
import {
  isNetReachable,
  NET_LATENCY_MS,
  type ScenarioRuntime,
  type ScenarioState,
} from './state.js'

/**
 * fake 的 HTTP 数据面：只实现首版会走到的路由，未覆盖的接口固定 404。
 *
 * 与真壳的约定一致：
 * - HTTP 非 2xx 仍然 `{ok:true,result:{status,...}}`，和浏览器 fetch 一样由 client.ts 判断；
 * - 只有「请求没到达服务端」才 `{ok:false,error:{code:'network'}}`；
 * - 响应体一律 base64，避免 JSON 字符串与二进制混在一起。
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const statusText = (status: number): string => {
  if (status === 200) {
    return 'OK'
  }
  if (status === 201) {
    return 'Created'
  }
  if (status === 204) {
    return 'No Content'
  }
  if (status === 400) {
    return 'Bad Request'
  }
  if (status === 401) {
    return 'Unauthorized'
  }
  if (status === 404) {
    return 'Not Found'
  }
  return ''
}

const textResponse = (
  status: number,
  body: string,
  contentType = 'application/json'
): NetResponse => ({
  status,
  statusText: statusText(status),
  headers: { 'content-type': contentType },
  body: encodeTextBase64(body),
})

const jsonResponse = (status: number, value: unknown): NetResponse =>
  textResponse(status, JSON.stringify(value))

const errorResponse = (status: number, message: string): NetResponse =>
  jsonResponse(status, { error: { message } })

/** `/api/v1/chats/:id` 的 id；其它路径返回 null */
const chatIdFromPath = (path: string): string | null => {
  const match = /^\/api\/v1\/chats\/([^/]+)$/.exec(path)
  return match ? decodeURIComponent(match[1]) : null
}

const bodyText = (spec: NetRequestSpec): string => {
  if (!spec.body) {
    return ''
  }
  return spec.body.kind === 'text' ? spec.body.text : decodeTextBase64(spec.body.base64)
}

const readJsonBody = (spec: NetRequestSpec): Record<string, unknown> | null => {
  const raw = bodyText(spec)
  if (!raw) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const sessionResponse = (state: ScenarioState): NetResponse => {
  if (!state.authenticated) {
    return errorResponse(401, '登录已过期')
  }
  const account = state.accounts.find((entry) => entry.self)
  return jsonResponse(200, {
    user: {
      id: account?.id ?? 'acc_gx',
      username: account?.username ?? 'gx',
      avatar: '',
      groups: account?.groups ?? ['User', 'Owner'],
      disabled: false,
      createdAt: 1795737600000,
      updatedAt: 1795737600000,
    },
    csrf: 'scenario-csrf',
    expiresAt: FIXED_SESSION_EXPIRES,
    hasApiKey: true,
  })
}

const settingsResponse = (state: ScenarioState): NetResponse =>
  jsonResponse(200, {
    preferences: { ...state.preferences },
    hasApiKey: true,
    updatedAt: FIXED_UPDATED_AT,
  })

const untouchedFileResponse = (): NetResponse => ({
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'image/png' },
  body: FIXED_PNG_BASE64,
})

/** 按 method + path 分派；返回统一响应，调用方负责包进 done */
const routeRequest = (state: ScenarioState, spec: NetRequestSpec): NetResponse => {
  const method = spec.method.toUpperCase()
  const path = spec.url.split('?')[0]

  if (path === '/api/v1/auth/me') {
    return sessionResponse(state)
  }
  if (path === '/api/v1/auth/login' && method === 'POST') {
    const body = readJsonBody(spec)
    if (!body) {
      return errorResponse(400, '请求体不是合法 JSON')
    }
    const username = readString(body.username) ?? ''
    const password = readString(body.password) ?? ''
    if (username !== 'gx' || password !== 'demo1234') {
      return errorResponse(401, '用户名或密码错误')
    }
    state.authenticated = true
    return sessionResponse(state)
  }
  if (path === '/api/v1/auth/logout' && method === 'POST') {
    state.authenticated = false
    return jsonResponse(200, { ok: true })
  }
  if (path === '/api/v1/auth/password' && method === 'POST') {
    const body = readJsonBody(spec)
    if (!body) {
      return errorResponse(400, '请求体不是合法 JSON')
    }
    const next = readString(body.newPassword) ?? ''
    return next.length >= 8 ? jsonResponse(200, { ok: true }) : errorResponse(400, '密码至少 8 位')
  }
  if (path === '/api/v1/auth/username' && method === 'PUT') {
    const body = readJsonBody(spec)
    if (!body) {
      return errorResponse(400, '请求体不是合法 JSON')
    }
    const next = (readString(body.username) ?? '').trim()
    return /^[A-Za-z0-9._-]{1,64}$/.test(next)
      ? jsonResponse(200, { ok: true })
      : errorResponse(400, '用户名只能用 1–64 个字母、数字或 . _ -')
  }
  if (path === '/api/v1/auth/avatar' && method === 'PUT') {
    return jsonResponse(200, { ok: true })
  }
  if (path === '/api/v1/settings' && method === 'GET') {
    return settingsResponse(state)
  }
  if (path === '/api/v1/settings' && method === 'PUT') {
    const body = readJsonBody(spec)
    if (!body || !isRecord(body.preferences)) {
      return errorResponse(400, '请求体缺少 preferences')
    }
    state.preferences = { ...state.preferences, ...body.preferences }
    if (state.preferences.locale === 'en-US' || state.preferences.locale === 'zh-CN') {
      state.locale = state.preferences.locale
    }
    return settingsResponse(state)
  }
  if (path === '/api/v1/settings/api-key' && (method === 'PUT' || method === 'DELETE')) {
    return jsonResponse(200, { ok: true })
  }
  if (path === '/api/v1/settings/api-key/verify' && method === 'POST') {
    const body = readJsonBody(spec)
    if (!body) {
      return errorResponse(400, '请求体不是合法 JSON')
    }
    const apiKey = readString(body.apiKey) ?? ''
    return apiKey.length >= 8 ? jsonResponse(200, { ok: true }) : errorResponse(400, 'API Key 无效')
  }
  if (path === '/api/v1/chats' && method === 'GET') {
    // 每次返回副本：调用方改数组/字段不会污染场景状态，JSON 字节序仍然固定。
    return jsonResponse(200, {
      chats: state.chats.summaries.map((summary) => ({ ...summary })),
    })
  }
  const chatId = chatIdFromPath(path)
  if (chatId !== null) {
    if (method === 'GET') {
      const stored = state.chats.sessions.get(chatId)
      if (!stored) {
        return errorResponse(404, '会话不存在')
      }
      return jsonResponse(200, { session: stored.session, version: stored.version })
    }
    if (method === 'DELETE') {
      const stored = state.chats.sessions.get(chatId)
      if (!stored) {
        return errorResponse(404, '会话不存在')
      }
      state.chats.sessions.delete(chatId)
      state.chats.summaries = state.chats.summaries.filter((summary) => summary.id !== chatId)
      // 真实服务端是 204 No Content；这里保持一致，客户端不解析空 body。
      return { status: 204, statusText: 'No Content', headers: {} }
    }
    // PUT / PATCH（保存）保持原来的行为：未覆盖的接口走 404，不伪造保存成功。
  }
  if (path.startsWith('/api/v1/files/')) {
    if (method === 'GET') {
      return untouchedFileResponse()
    }
    if (method === 'DELETE') {
      return jsonResponse(200, { ok: true })
    }
  }

  return errorResponse(404, `场景未覆盖的接口：${method} ${path}`)
}

export const dispatchNetRequest = (
  runtime: ScenarioRuntime,
  id: string,
  specJson: string
): void => {
  let spec: NetRequestSpec
  try {
    const parsed: unknown = JSON.parse(specJson)
    if (!isRecord(parsed) || typeof parsed.url !== 'string') {
      throw new Error('spec 缺少 url')
    }
    spec = parsed as unknown as NetRequestSpec
  } catch {
    runtime.fail(id, { code: 'protocol', message: 'netRequest spec 不是合法 JSON' })
    return
  }

  runtime.after(id, NET_LATENCY_MS, () => {
    if (!isNetReachable(runtime.state)) {
      runtime.fail(id, { code: 'network', cause: 'ECONNREFUSED' })
      return
    }
    runtime.done(id, routeRequest(runtime.state, spec))
  })
}

/**
 * SSE：固定事件按固定间隔逐条投递。
 * 第一条事件先到，fetch 因此能在 done 之前拿到响应头；最后一条之后 close。
 */
export const dispatchNetStream = (runtime: ScenarioRuntime, id: string, specJson: string): void => {
  let spec: NetRequestSpec
  try {
    const parsed: unknown = JSON.parse(specJson)
    if (!isRecord(parsed) || typeof parsed.url !== 'string') {
      throw new Error('spec 缺少 url')
    }
    spec = parsed as unknown as NetRequestSpec
  } catch {
    runtime.fail(id, { code: 'protocol', message: 'netStream spec 不是合法 JSON' })
    return
  }

  const path = spec.url.split('?')[0]
  if (path !== '/api/v1/stream') {
    runtime.after(id, NET_LATENCY_MS, () => {
      runtime.done(id, errorResponse(404, `场景未覆盖的流式接口：${path}`))
    })
    return
  }

  if (!isNetReachable(runtime.state)) {
    runtime.after(id, NET_LATENCY_MS, () => {
      runtime.fail(id, { code: 'network', cause: 'ECONNREFUSED' })
    })
    return
  }

  const step = 90
  FIXED_SSE_EVENTS.forEach((event, index) => {
    runtime.after(id, NET_LATENCY_MS + index * step, () => {
      runtime.chunkText(id, `${event}\n\n`)
    })
  })
  runtime.after(id, NET_LATENCY_MS + FIXED_SSE_EVENTS.length * step + 30, () => {
    runtime.done(id, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  })
}

const fileObject = (spec: NetUploadSpec): Record<string, unknown> => {
  const first = spec.files[0]
  const size = spec.files.reduce((total, file) => total + file.size, 0)
  return {
    id: 'file_scenario_1',
    type: 'file',
    size_bytes: size,
    created_at: '2026-11-27T16:00:00+08:00',
    filename: first?.name ?? 'upload.bin',
    mime_type: first?.mime ?? 'application/octet-stream',
  }
}

export const dispatchNetUpload = (runtime: ScenarioRuntime, id: string, specJson: string): void => {
  let spec: NetUploadSpec
  try {
    const parsed: unknown = JSON.parse(specJson)
    if (!isRecord(parsed) || !Array.isArray(parsed.files) || !Array.isArray(parsed.fields)) {
      throw new Error('spec 缺少 files/fields')
    }
    spec = parsed as unknown as NetUploadSpec
  } catch {
    runtime.fail(id, { code: 'protocol', message: 'netUpload spec 不是合法 JSON' })
    return
  }

  runtime.after(id, NET_LATENCY_MS + 100, () => {
    if (!isNetReachable(runtime.state)) {
      runtime.fail(id, { code: 'network', cause: 'ECONNREFUSED' })
      return
    }
    for (const file of spec.files) {
      const temp = runtime.state.tempFiles.get(file.tempId)
      if (!temp || !temp.closed) {
        runtime.fail(id, { code: 'protocol', message: `临时文件不存在：${file.tempId}` })
        return
      }
    }
    if (spec.files.some((file) => file.name.includes('fail'))) {
      runtime.done(id, errorResponse(400, '附件内容被场景拒绝'))
      return
    }
    runtime.done(id, jsonResponse(200, fileObject(spec)))
  })
}

/** fileBegin 的 meta 校验结果；坏数字按 0 处理，避免 fake 自己崩掉 */
export const normalizeUploadMeta = (metaJson: string): UploadMeta => {
  try {
    const parsed: unknown = JSON.parse(metaJson)
    if (isRecord(parsed)) {
      return {
        name: readString(parsed.name) ?? 'blob',
        mime: readString(parsed.mime) ?? 'application/octet-stream',
        size: typeof parsed.size === 'number' && Number.isFinite(parsed.size) ? parsed.size : 0,
      }
    }
  } catch {
    // 落到默认元信息；fake 的职责是继续跑完，而不是模拟壳的参数校验。
  }
  return { name: 'blob', mime: 'application/octet-stream', size: 0 }
}
