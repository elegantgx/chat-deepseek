import { useEffect, useState } from 'react'
import { PAGES } from '../pages'
import { Shell } from './frame'
import { HostProvider, useSystemStatus } from './host'
import { navigate, parseHash } from './location'
import { StatusFooter } from './StatusFooter'
import type { ConnectionState } from './StatusFooter'
import { ThemeProvider } from './theme'
import type { Route } from './location'

/** 侧栏状态是全局的，页面写操作之后最多等这么久就能看到一致结果 */
const STATUS_POLL_MS = 5000

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

function AppFrame({ route }: { route: Route }) {
  const status = useSystemStatus()
  const { reload } = status
  const Page = PAGES[route.page]

  useEffect(() => {
    const timer = window.setInterval(() => {
      reload()
    }, STATUS_POLL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [reload])

  return (
    <Shell
      active={route.page}
      onNavigate={navigate}
      footer={<StatusFooter {...footerState(status)} />}
    >
      <Page />
    </Shell>
  )
}

/** 把 system.status 的三个状态（加载中 / 失败 / 有数据）压成侧栏底部两行 */
function footerState(status: ReturnType<typeof useSystemStatus>): {
  state: ConnectionState
  label: string
  version: string
} {
  if (status.error) {
    return { state: 'err', label: '后端不可用', version: status.error.code }
  }
  if (!status.data) {
    return { state: 'off', label: '正在连接后端…', version: '—' }
  }
  return {
    state: status.data.service.state === 'running' ? 'ok' : 'off',
    label: `本地 · ${status.data.service.state === 'running' ? '运行中' : '已停止'}`,
    version: status.data.version,
  }
}

export function App() {
  const route = useRoute()
  // 主题只在启动时读一次 hash，之后由页面里的开关控制，导航不再把它重置
  const [initialTheme] = useState(() => parseHash(window.location.hash).theme ?? 'system')

  return (
    <ThemeProvider initial={initialTheme}>
      <HostProvider>
        <AppFrame route={route} />
      </HostProvider>
    </ThemeProvider>
  )
}
