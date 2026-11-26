import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SystemStatus } from './ipc-types'
import { createMockHost } from './mock-host'

/** 失败值统一成 {code,message}：preload 抛的是纯对象，浏览器里的 Error 也归一化到这里 */
export interface HostError {
  code: string
  message: string
}

export interface HostClient {
  request(method: string, params?: unknown): Promise<unknown>
  onEvent(listener: (method: string, params: unknown) => void): () => void
  /** 数据来自浏览器里的替身（直接打开渲染层、没有 preload），仅用于调试与截图 */
  mock: boolean
}

export function normalizeHostError(value: unknown): HostError {
  if (typeof value === 'object' && value !== null && 'code' in value && 'message' in value) {
    const { code, message } = value as { code: unknown; message: unknown }
    return { code: String(code), message: String(message) }
  }
  if (value instanceof Error) {
    return { code: 'internal', message: value.message }
  }
  return { code: 'internal', message: '未知错误' }
}

const HostContext = createContext<HostClient | null>(null)

/**
 * 连接后端。Electron 里用 preload 注入的 `window.host`；纯浏览器里退回内存替身，
 * 这样页面只有一条数据通路，截图验收也不用另写一套。
 */
export function HostProvider({ children }: { children: ReactNode }) {
  const client = useMemo<HostClient>(() => {
    const injected = window.host
    if (injected) {
      return {
        request: (method, params) => injected.request(method, params),
        onEvent: (listener) => injected.onEvent(listener),
        mock: false,
      }
    }
    return createMockHost()
  }, [])

  return <HostContext.Provider value={client}>{children}</HostContext.Provider>
}

export function useHost(): HostClient {
  const host = useContext(HostContext)
  if (!host) {
    throw new Error('useHost 必须在 HostProvider 内使用')
  }
  return host
}

/** 订阅一个后端事件；handler 变化不会重订阅（放进 ref），避免调用方写 useCallback */
export function useHostEvent(method: string, handler: (params: unknown) => void): void {
  const host = useHost()
  const [handlerRef] = useState(() => ({ current: handler }))
  handlerRef.current = handler

  useEffect(() => {
    return host.onEvent((eventMethod, params) => {
      if (eventMethod === method) {
        handlerRef.current(params)
      }
    })
  }, [host, method, handlerRef])
}

export interface RequestState<T> {
  data: T | null
  error: HostError | null
  loading: boolean
  reload: () => void
}

/**
 * 读一次远端数据。params 用序列化后的值做依赖，避免调用方每帧传新对象把请求打爆。
 * enabled=false 时不动（比如等登录态确定之后再拉账户列表）。
 */
export function useRequest<T>(method: string, params?: unknown, enabled = true): RequestState<T> {
  const host = useHost()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<HostError | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [nonce, setNonce] = useState(0)
  const key = JSON.stringify(params ?? null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    host
      .request(method, params)
      .then((result) => result as T)
      .then(
        (result) => {
          if (cancelled) {
            return
          }
          setData(result)
          setError(null)
        },
        (failure: unknown) => {
          if (cancelled) {
            return
          }
          setError(normalizeHostError(failure))
        }
      )
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
    // params 以 key 参与依赖，见上
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, method, key, enabled, nonce])

  const reload = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  return { data, error, loading, reload }
}

/** 侧栏与页面都要的服务状态：外壳用它，页面写操作成功后 reload */
export function useSystemStatus(): RequestState<SystemStatus> {
  return useRequest<SystemStatus>('system.status')
}
