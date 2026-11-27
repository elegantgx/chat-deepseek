import { callBridge, subscribeBridgeEvent } from './callbacks.js'
import { getShellRuntime } from './shell.js'

/**
 * ipc 控制面的渲染层客户端，形状对齐 `desktop/renderer/app/host.tsx`：
 * `request(method, params)` / `onEvent(listener)` / `mock`。
 *
 * 方法名、参数与结果都沿用 `docs/ipc.md`，页面只换数据来源，不因为 Android 改写法。
 */

export interface HostError {
  code: string
  message: string
  status?: number
  cause?: string
}

export interface HostClient {
  request(method: string, params?: unknown): Promise<unknown>
  onEvent(listener: (method: string, params: unknown) => void): () => void
  /** 数据来自浏览器里的 fake（没有壳注入），仅用于调试与截图 */
  mock: boolean
}

/** 把壳/桥抛的几种错误归一成 `{code,message}`，页面只处理这一种 */
export const normalizeHostError = (value: unknown): HostError => {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const { code, message, status, cause } = value as {
      code?: unknown
      message?: unknown
      status?: unknown
      cause?: unknown
    }
    return {
      code: typeof code === 'string' ? code : 'internal',
      message: typeof message === 'string' ? message : '',
      ...(typeof status === 'number' ? { status } : {}),
      ...(typeof cause === 'string' ? { cause } : {}),
    }
  }
  if (value instanceof Error) {
    return { code: 'internal', message: value.message }
  }
  return { code: 'internal', message: '未知错误' }
}

export const createHostClient = (): HostClient => {
  const runtime = getShellRuntime()
  return {
    request: (method, params) =>
      callBridge<unknown>(
        (id) => {
          runtime.shell.host(id, method, JSON.stringify(params ?? {}))
        },
        {
          // host 没有公开取消接口（与桌面同形）；壳自己 abort 时也走同一条 reject 路径。
          abort: (id) => runtime.shell.abort(id),
        }
      ),
    onEvent: (listener) => subscribeBridgeEvent(listener),
    mock: runtime.mock,
  }
}
