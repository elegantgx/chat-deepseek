import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { ScreenId } from '../screens/registry.js'

/**
 * 路由上下文单独成文件，是为了斩断「router → registry → screens → router」的循环：
 * 屏只 import 这里的 Hook，路由只 import 这里的 Provider。
 * 后续 36 屏不要从 `app/router.tsx` 取导航。
 */
export interface Route {
  screen: ScreenId
  /** hash 或 query 里的页面参数；路由已去掉 screen/scenario */
  params: URLSearchParams
}

export interface RouteContextValue extends Route {
  navigate: (screen: ScreenId, params?: Record<string, string>) => void
}

const RouteContext = createContext<RouteContextValue | null>(null)

export const RouteProvider = ({
  value,
  children,
}: {
  value: RouteContextValue
  children: ReactNode
}) => <RouteContext.Provider value={value}>{children}</RouteContext.Provider>

export const useRoute = (): Route => {
  const context = useContext(RouteContext)
  if (!context) {
    throw new Error('useRoute 必须在 Router 内使用')
  }
  return context
}

export const useNavigate = (): RouteContextValue['navigate'] => {
  const context = useContext(RouteContext)
  if (!context) {
    throw new Error('useNavigate 必须在 Router 内使用')
  }
  return context.navigate
}
