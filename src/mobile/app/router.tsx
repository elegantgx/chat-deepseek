import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ShellReady } from '../bridge/types.js'
import { resolveScreenParam, screenMeta, screens, type ScreenId } from '../screens/registry.js'
import { TopBar } from '../ui/TopBar.js'
import { RouteProvider, type Route, type RouteContextValue } from './navigation.js'
import styles from './router.module.css'

/**
 * 最小路由：屏 id ↔ 组件。
 *
 * - 直达用 query：`?screen=server-stopped`，也接受编号 `?screen=9`；
 * - 屏内跳转用 hash：`#/server-backup-detail?file=...`，这样 `file://` 打开 dist 也能用
 *   （file:// 下 pushState 不保证可用，hash 最稳）；
 * - 未注册的屏渲染占位，骨架阶段 36 屏还没实现时也能构建、能截图。
 */

const parseHash = (): { screen: string | null; params: URLSearchParams | null } => {
  const value = window.location.hash.replace(/^#\/?/, '')
  if (!value) {
    return { screen: null, params: null }
  }
  const queryIndex = value.indexOf('?')
  const path = queryIndex === -1 ? value : value.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : value.slice(queryIndex + 1)
  return { screen: path, params: new URLSearchParams(query) }
}

const readRoute = (fallback: ScreenId): Route => {
  const hash = parseHash()
  const search = new URLSearchParams(window.location.search)
  const screen =
    resolveScreenParam(hash.screen) ?? resolveScreenParam(search.get('screen')) ?? fallback
  const params = hash.params ?? new URLSearchParams(window.location.search)
  params.delete('screen')
  params.delete('scenario')
  return { screen, params }
}

export const Router = ({ fallback }: { fallback: ScreenId }) => {
  const [route, setRoute] = useState<Route>(() => readRoute(fallback))

  useEffect(() => {
    const onHashChange = () => {
      setRoute(readRoute(fallback))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [fallback])

  const navigate = useCallback((screen: ScreenId, params?: Record<string, string>) => {
    const query = params ? new URLSearchParams(params).toString() : ''
    window.location.hash = `/${screen}${query ? `?${query}` : ''}`
  }, [])

  const value = useMemo<RouteContextValue>(
    () => ({ screen: route.screen, params: route.params, navigate }),
    [route, navigate]
  )
  const Screen = screens[route.screen]
  return (
    <RouteProvider value={value}>
      {Screen ? <Screen /> : <ScreenPlaceholder screen={route.screen} />}
    </RouteProvider>
  )
}

/** 首启进入哪一屏：只根据启动上下文做最小判断，具体流程由 36 屏接管 */
export const defaultScreen = (ready: ShellReady): ScreenId => {
  const selected =
    ready.servers.find((server) => server.id === ready.selectedId) ?? ready.servers[0]
  if (!selected) {
    return 'launch'
  }
  if (selected.kind === 'remote') {
    return selected.mode === 'stopped' ? 'server-remote-detail-offline' : 'server-remote-detail'
  }
  if (selected.mode === 'uninitialized') {
    return 'server-uninit'
  }
  if (selected.mode === 'stopped') {
    return 'server-stopped'
  }
  return 'chat-welcome'
}

const ScreenPlaceholder = ({ screen }: { screen: ScreenId }) => {
  const translate = useTranslate()
  const meta = screenMeta(screen)
  const number = meta ? String(meta.number).padStart(2, '0') : '--'
  return (
    <div className={styles.screen}>
      <TopBar title={meta ? translate(meta.titleKey) : screen} />
      <div className={styles.body}>
        <p className={styles.kicker}>
          {number} · {screen}
        </p>
        <p className={styles.message}>{translate('mobileNotImplemented')}</p>
      </div>
    </div>
  )
}
