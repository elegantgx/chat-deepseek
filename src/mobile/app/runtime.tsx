import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { HostClient } from '../bridge/host.js'
import type { ShellReady } from '../bridge/types.js'

/**
 * 外壳级运行时上下文：屏组件不通过 props 拿数据，避免 36 屏各带一包重复参数。
 * 这里只放启动上下文与 host；网络一律走被替换过的 fetch，不在上下文里另开一条。
 */
export interface ShellRuntime {
  ready: ShellReady
  host: HostClient
  /** 数据来自 fake；页面不应据此改布局，只用于调试与降级提示 */
  mock: boolean
}

const RuntimeContext = createContext<ShellRuntime | null>(null)

export const RuntimeProvider = ({
  value,
  children,
}: {
  value: ShellRuntime
  children: ReactNode
}) => <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>

const useRuntime = (): ShellRuntime => {
  const runtime = useContext(RuntimeContext)
  if (!runtime) {
    throw new Error('useRuntime 必须在 Shell 内使用')
  }
  return runtime
}

export const useReady = (): ShellReady => useRuntime().ready
export const useHost = (): HostClient => useRuntime().host
export const useIsMock = (): boolean => useRuntime().mock
