import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { translate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { createHostClient } from './bridge/host.js'
import { installBridge } from './bridge/install.js'
import { installBridgeCallbacks } from './bridge/callbacks.js'
import { resolveShell, type ShellRuntime as BridgeRuntime } from './bridge/shell.js'
import { Router, defaultScreen } from './app/router.js'
import { Shell } from './app/Shell.js'
import { applyTheme, installTheme, resolveTheme, systemThemeQuery } from './app/theme.js'
import './app/global.css'

/**
 * mobile Web 入口（只有 `rspack.mobile.config.ts` 用它）。
 *
 * 顺序很重要：先注册回调并替换 fetch，再画启动态，最后才同步取 `ready()`。
 * - fetch 必须先换好，首屏任何 services/* 的请求才会走桥，不会漏到真实网络；
 * - `ready()` 是同步的、冷启动最坏会卡 1.2s，不能放在顶层 await 之后再 render，
 *   否则白屏；先渲染启动占位，等首帧上屏后再调，拿到的上下文触发第二次渲染。
 */

const search = new URLSearchParams(window.location.search)
// `?scenario=` / `?locale=` 只影响 fake；真壳注入后以 ready() 为准。

installBridgeCallbacks()
installBridge()
installTheme()
// ready() 之前先按系统深浅色铺底，启动态不会先闪白；拿到 ready() 后再按偏好覆盖。
applyTheme(resolveTheme('system', systemThemeQuery.matches))

const container = document.getElementById('root')
if (!container) {
  throw new Error('mobile index.html 缺少 #root')
}

const root = createRoot(container)

/**
 * 启动占位：尺寸对齐示意里 launch 屏的鲸鱼位，切到真实 launch 屏时不会明显跳动。
 * 只画一个骨架块，不复制 launch 屏的内容（那一屏归 screens 实现）。
 */
const BOOT_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  background: 'var(--bg)',
  color: 'var(--text)',
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
}

const BOOT_MARK_STYLE: CSSProperties = {
  width: 132,
  height: 132,
  borderRadius: '50%',
  background: 'var(--brand-soft)',
}

const BootSplash = () => (
  <div style={BOOT_STYLE} aria-busy="true">
    <div style={BOOT_MARK_STYLE} />
  </div>
)

/** 启动上下文都拿不到时不能留白屏：给一句人话 + 重载，和 Shell 的错误边界同形 */
const BootError = ({ detail }: { detail: string }) => (
  <div style={{ ...BOOT_STYLE, flexDirection: 'column', gap: 18, padding: '0 36px' }}>
    <p style={{ color: 'var(--text)', textAlign: 'center' }}>{translate('mobileShellCrashed')}</p>
    <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', wordBreak: 'break-all' }}>
      {detail}
    </p>
    <button type="button" onClick={() => window.location.reload()}>
      {translate('mobileShellReload')}
    </button>
  </div>
)

const MobileRoot = () => {
  const [bridge, setBridge] = useState<BridgeRuntime | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // 用 rAF 把同步的 ready() 推到启动态上屏之后；effect 里的同步调用仍可能
    // 赶在首帧绘制前执行，rAF 至少让这一帧先画出来。
    const frame = requestAnimationFrame(() => {
      try {
        const runtime = resolveShell(search.get('scenario'), search.get('locale'))
        // ready() 是主题/语言的权威值；直接写 store 而不走 setThemePreference/setLocale，
        // 避免启动时为了“同步设置”再向服务端发一次 PUT。
        useSettings.setState({
          locale: runtime.ready.locale,
          themePreference: runtime.ready.theme,
        })
        applyTheme(resolveTheme(runtime.ready.theme, systemThemeQuery.matches))
        document.documentElement.lang = runtime.ready.locale
        if (!cancelled) {
          setBridge(runtime)
        }
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : String(error))
        }
      }
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [])

  // host 客户端依赖 resolveShell 的全局运行时，拿到桥之后才能建
  const host = useMemo(() => (bridge ? createHostClient() : null), [bridge])

  if (bootError) {
    return <BootError detail={bootError} />
  }
  if (!bridge || !host) {
    return <BootSplash />
  }
  return (
    <Shell runtime={{ ready: bridge.ready, host, mock: bridge.mock }}>
      <Router fallback={defaultScreen(bridge.ready)} />
    </Shell>
  )
}

root.render(<MobileRoot />)
