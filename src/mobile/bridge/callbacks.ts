import { decodeBytes, encodeBytes } from './codec.js'
import type { BridgeEnvelope, BridgeError, ChatBridge } from './types.js'

/**
 * 桥回调的 JS 侧：按 `id` 把壳的 `done`/`chunk` 派发给在途调用。
 *
 * 这一层只做「一次调用一条 Promise」的簿记，不认识 host/net：
 * - `done` 只认第一次，重复或迟到（已经 abort）的回调直接丢掉；
 * - `chunk` 按 ≤32 KiB 切成多条投递（§4.1），绝不截断丢字节；
 * - 每个调用都有看门狗：壳丢一条 `done` 时不能让 `pending` 永久挂着、UI 永远转圈；
 * - abort 时先摘掉在途项再 reject，迟到的 done 不会二次 settle。
 */

/** 一条 chunk 允许的原文上限；超限说明壳聚合出了偏大的帧，切条投递而不是丢字节 */
export const MAX_CHUNK_BYTES = 32 * 1024

/**
 * 看门狗分三档，按调用的形态选：
 * - 一次性调用（host/platform/netRequest）等一条 `done`，120s 足够覆盖正常的服务端处理；
 * - 流式调用（netStream/netDownload）先等首包 30s，之后每来一块就重置 90s 心跳。
 *   壳丢 done 或子进程被杀时，心跳停了就能自动收尾，而不是永久 pending。
 */
const REQUEST_TIMEOUT_MS = 120_000
const STREAM_FIRST_CHUNK_TIMEOUT_MS = 30_000
const STREAM_HEARTBEAT_TIMEOUT_MS = 90_000

/** 渲染层主动取消；host 与 net 都可能拿到它 */
export class AbortedError extends Error {
  readonly code = 'aborted'

  constructor() {
    super('aborted')
    this.name = 'AbortError'
  }
}

/**
 * 看门狗超时：表现和断网一致（`network`），不引入新错误码；
 * `cause` 固定 `timeout`，方便和真正的连接失败区分。
 */
class BridgeTimeoutError extends Error {
  readonly code = 'network'
  override readonly cause = 'timeout'

  constructor() {
    super('bridge call timed out')
    this.name = 'BridgeTimeoutError'
  }
}

export interface CallOptions {
  /** 外部取消信号；abort 后调用 `shell.abort(id)` 并 reject 一个 `AbortedError` */
  signal?: AbortSignal
  /** netStream/netDownload 的字节回调；有它即按流式调用套首包/心跳超时 */
  onChunk?: (bytes: Uint8Array) => void
  /** 取消时通知壳（通常就是 `shell.abort`），由调用方注入避免 bridge 反向依赖 */
  abort?: (id: string) => void
  /** 一次性调用的整体超时；不传按 120s（上传大文件时由调用方放宽） */
  timeoutMs?: number
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  onChunk?: (bytes: Uint8Array) => void
  /** 收到一块字节后重置流式心跳 */
  touch: () => void
  /** 结算前清计时器、摘掉 abort 监听 */
  dispose: () => void
  /** 解码/回调失败时通知壳停止推流，别让壳继续往一个已经放弃的 id 发数据 */
  abortShell: () => void
}

const pending = new Map<string, PendingCall>()

/** id 只要求进程内唯一、对壳不透明；按调用顺序自增即可，不需要随机数 */
let sequence = 0

const nextCallId = (): string => `m${(sequence += 1)}`

const protocolError = (message: string): BridgeError => ({ code: 'protocol', message })

const normalizeError = (value: unknown): BridgeError => {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const { code, message, status, cause, body } = value as Partial<BridgeError>
    if (typeof code === 'string') {
      return {
        code,
        ...(typeof message === 'string' ? { message } : {}),
        ...(typeof status === 'number' ? { status } : {}),
        ...(typeof cause === 'string' ? { cause } : {}),
        ...(typeof body === 'string' ? { body } : {}),
      }
    }
  }
  if (value instanceof Error && value.name === 'AbortError') {
    return { code: 'aborted', message: value.message }
  }
  return protocolError(value instanceof Error ? value.message : '桥返回了未知错误')
}

/**
 * 发起一次桥调用并等 `done`。
 *
 * `send` 只负责调用壳的方法（host/netRequest/netStream/netDownload/netUpload/platform），
 * id 已由这里生成；这样每个调用点的代码都只关心参数。
 */
export const callBridge = <T>(
  send: (id: string) => void,
  options: CallOptions = {}
): Promise<T> => {
  const { signal, onChunk, abort } = options
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError())
      return
    }
    const id = nextCallId()
    const isStream = typeof onChunk === 'function'
    const activeTimers = new Set<ReturnType<typeof setTimeout>>()
    let firstChunkTimer: ReturnType<typeof setTimeout> | null = null
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null

    const stopTimer = (timer: ReturnType<typeof setTimeout> | null) => {
      if (timer === null) {
        return
      }
      clearTimeout(timer)
      activeTimers.delete(timer)
    }
    const stopTimers = () => {
      for (const timer of activeTimers) {
        clearTimeout(timer)
      }
      activeTimers.clear()
      firstChunkTimer = null
      heartbeatTimer = null
    }
    const schedule = (ms: number): ReturnType<typeof setTimeout> => {
      const timer = setTimeout(() => {
        activeTimers.delete(timer)
        onTimeout()
      }, ms)
      activeTimers.add(timer)
      return timer
    }
    const abortShell = () => {
      try {
        abort?.(id)
      } catch {
        // 壳的 abort 失败不能盖住超时/取消这个事实，吞掉继续 reject。
      }
    }

    const detach = () => {
      signal?.removeEventListener('abort', onAbort)
    }
    const onTimeout = () => {
      if (!pending.delete(id)) {
        return
      }
      detach()
      stopTimers()
      abortShell()
      reject(new BridgeTimeoutError())
    }
    const onAbort = () => {
      if (!pending.delete(id)) {
        return
      }
      detach()
      stopTimers()
      abortShell()
      reject(new AbortedError())
    }

    /** 首块到达后把首包计时换成心跳计时；后续每块都重置心跳 */
    const touch = () => {
      if (firstChunkTimer !== null) {
        stopTimer(firstChunkTimer)
        firstChunkTimer = null
      }
      stopTimer(heartbeatTimer)
      heartbeatTimer = schedule(STREAM_HEARTBEAT_TIMEOUT_MS)
    }

    pending.set(id, {
      resolve: (value) => {
        detach()
        stopTimers()
        resolve(value as T)
      },
      reject: (reason) => {
        detach()
        stopTimers()
        reject(reason)
      },
      ...(onChunk ? { onChunk } : {}),
      touch,
      dispose: () => {
        detach()
        stopTimers()
      },
      abortShell,
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (isStream) {
      firstChunkTimer = schedule(STREAM_FIRST_CHUNK_TIMEOUT_MS)
    } else {
      schedule(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    }
    try {
      send(id)
    } catch (error) {
      if (pending.delete(id)) {
        detach()
        stopTimers()
        reject(error)
      }
    }
  })
}

/** 壳回调 `done(id, envelopeJson)`；每个 id 最多成功派发一次 */
const done = (id: string, envelopeJson: string): void => {
  const entry = pending.get(id)
  if (!entry) {
    // 已经 abort / 已经 done / 已超时，迟到的回调按「只认第一次」丢弃。
    return
  }
  pending.delete(id)
  entry.dispose()
  let envelope: BridgeEnvelope
  try {
    envelope = JSON.parse(envelopeJson) as BridgeEnvelope
  } catch {
    entry.reject(protocolError('done 不是合法 JSON'))
    return
  }
  if (typeof envelope !== 'object' || envelope === null || typeof envelope.ok !== 'boolean') {
    entry.reject(protocolError('done 信封缺少 ok'))
    return
  }
  if (envelope.ok) {
    entry.resolve(envelope.result)
    return
  }
  entry.reject(normalizeError(envelope.error))
}

/** 壳回调 `chunk(id, base64)`；解码失败按协议错误结束这次调用，并让壳停止推流 */
const chunk = (id: string, base64: string): void => {
  const entry = pending.get(id)
  if (!entry?.onChunk) {
    return
  }
  let bytes: Uint8Array
  try {
    bytes = decodeBytes(base64)
  } catch {
    pending.delete(id)
    entry.dispose()
    entry.abortShell()
    entry.reject(protocolError('chunk 不是合法 base64'))
    return
  }
  if (bytes.length === 0) {
    return
  }
  entry.touch()
  try {
    // 壳按 16 KiB 聚合，偶尔超 32 KiB 是正常波动：切成多条投递。
    // 以前这里截断到 MAX_CHUNK_BYTES，SSE 少一段就表现为「回答突然断了」且没有错误。
    for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_BYTES) {
      if (!pending.has(id)) {
        return
      }
      entry.onChunk(bytes.subarray(offset, offset + MAX_CHUNK_BYTES))
    }
  } catch (error) {
    // 订阅者（流控制器）抛错不能让异常穿过壳 eval 出来的调用，也不能让这次调用
    // 永远挂着：按协议错误收尾并通知壳停止推流。
    if (!pending.delete(id)) {
      return
    }
    entry.dispose()
    entry.abortShell()
    entry.reject(protocolError(error instanceof Error ? error.message : 'chunk 处理失败'))
  }
}

type BridgeEventListener = (method: string, params: unknown) => void

const eventListeners = new Set<BridgeEventListener>()

/** ipc 事件订阅；host.onEvent 直接转到这里，返回退订函数 */
export const subscribeBridgeEvent = (listener: BridgeEventListener): (() => void) => {
  eventListeners.add(listener)
  return () => {
    eventListeners.delete(listener)
  }
}

/**
 * 把一条事件派发给所有订阅者；fake 直接调用它，真壳经 window.__chatBridge.event 进来。
 * 逐个 try/catch：一个 UI 订阅者抛异常不能让后续订阅者收不到事件，也不能让异常
 * 从 `evaluateJavascript` 的调用里冒出去。
 */
export const emitBridgeEvent = (method: string, params: unknown): void => {
  for (const listener of [...eventListeners]) {
    try {
      listener(method, params)
    } catch {
      // 事件是尽力而为的观测通道，单个订阅者的 bug 不能打断整条派发。
    }
  }
}

const receiveEvent = (envelopeJson: string): void => {
  let envelope: { method?: unknown; params?: unknown }
  try {
    envelope = JSON.parse(envelopeJson) as { method?: unknown; params?: unknown }
  } catch {
    // 事件是尽力而为的观测通道，坏一帧不应该打断 UI。
    return
  }
  if (typeof envelope?.method === 'string') {
    emitBridgeEvent(envelope.method, envelope.params)
  }
}

/** 注册 `window.__chatBridge`；mobile 入口在 mount 前调用一次 */
export const installBridgeCallbacks = (): void => {
  if (window.__chatBridge) {
    return
  }
  const bridge: ChatBridge = { done, chunk, event: receiveEvent }
  window.__chatBridge = bridge
}

/** fake 用：把结果包成 done 信封 */
export const deliverDone = (id: string, envelope: BridgeEnvelope): void => {
  done(id, JSON.stringify(envelope))
}

/** fake 用：直接投递已编码的 chunk */
export const deliverChunk = (id: string, bytes: Uint8Array): void => {
  chunk(id, encodeBytes(bytes))
}
