import { useEffect, useState } from 'react'
import { PAGES } from '../pages'
import { Shell } from './frame'
import { navigate, parseHash } from './location'
import { StatusFooter } from './StatusFooter'
import { ThemeProvider } from './theme'

/**
 * 页面暂时用固定样本渲染侧栏状态与版本；接上 ipc 后由 `system.status` 提供，
 * 届时这里只剩「把 host 结果传下去」的职责。
 */
const FIXTURE_STATUS = {
  state: 'ok',
  label: '本地 · 运行中',
  version: '0.1.4-official0.1.4',
} as const

/**
 * hash 路由：`#service` / `#backup-dark`。Electron 里是 file://，没有服务端路由，
 * 所以不用 react-router；hash 同时给截图脚本当参数。
 */
function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])
  return route
}

export function App() {
  const route = useRoute()
  // 主题只在启动时读一次 hash，之后由页面里的开关控制，导航不再把它重置
  const [initialTheme] = useState(() => parseHash(window.location.hash).theme ?? 'system')
  const Page = PAGES[route.page]

  return (
    <ThemeProvider initial={initialTheme}>
      <Shell
        active={route.page}
        onNavigate={navigate}
        footer={<StatusFooter {...FIXTURE_STATUS} />}
      >
        <Page />
      </Shell>
    </ThemeProvider>
  )
}
