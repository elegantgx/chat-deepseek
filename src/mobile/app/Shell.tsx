import { Component, useEffect } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { translate } from '../../i18n/index.js'
import { FILE_SAVED_EVENT } from '../bridge/save-file.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../ui/Button.js'
import { RuntimeProvider } from './runtime.js'
import type { ShellRuntime } from './runtime.js'
import { ToastProvider, useToast } from './toast.js'
import { applyTheme, resolveTheme, systemThemeQuery } from './theme.js'
import styles from './Shell.module.css'

/**
 * 应用根容器：主题/语言跟随设置，安全区由这里统一留，toast 与错误边界都在外壳层。
 * 屏自己只负责内容，不重复这些全局关注点。
 */

/** 设置与系统深浅色变化时同步 `<html>`；main 已先应用一次，避免首帧闪白 */
const useAppearance = (): void => {
  useEffect(() => {
    const sync = () => {
      const { themePreference, locale } = useSettings.getState()
      applyTheme(resolveTheme(themePreference, systemThemeQuery.matches))
      document.documentElement.lang = locale
    }
    sync()
    const unsubscribe = useSettings.subscribe(sync)
    systemThemeQuery.addEventListener('change', sync)
    return () => {
      unsubscribe()
      systemThemeQuery.removeEventListener('change', sync)
    }
  }, [])
}

/**
 * 导出历史走 `<a download>` + blob URL，壳保存完成后派发事件；这里只负责 toast。
 * 不在桥层直接碰 React/toast，桥才能被 Node 里的 fake shell 验证。
 */
const FileSaveToast = () => {
  const { showToast } = useToast()
  useEffect(() => {
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ ok?: boolean }>).detail
      showToast(translate(detail?.ok ? 'mobileFileSaved' : 'mobileFileSaveFailed'))
    }
    window.addEventListener(FILE_SAVED_EVENT, onSaved)
    return () => {
      window.removeEventListener(FILE_SAVED_EVENT, onSaved)
    }
  }, [showToast])
  return null
}

interface ErrorBoundaryState {
  crashed: boolean
}

/**
 * 渲染错误兜底：白屏在 WebView 里几乎无法自查，所以这里给一句人话 + 重载按钮。
 * 不做自动重试，避免坏状态反复崩溃刷屏。
 */
class ShellErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { crashed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true }
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // 不向 console 输出：壳的日志里没有渲染层控制台，写这里也没人看；
    // 排查靠 `chrome://inspect` 连 WebView 时的现场。
  }

  override render(): ReactNode {
    if (!this.state.crashed) {
      return this.props.children
    }
    return (
      <div className={styles.crash}>
        <p>{translate('mobileShellCrashed')}</p>
        <Button onClick={() => window.location.reload()}>{translate('mobileShellReload')}</Button>
      </div>
    )
  }
}

export const Shell = ({ runtime, children }: { runtime: ShellRuntime; children: ReactNode }) => {
  useAppearance()
  return (
    <RuntimeProvider value={runtime}>
      <ToastProvider>
        <FileSaveToast />
        <ShellErrorBoundary>
          <div className={styles.root}>{children}</div>
        </ShellErrorBoundary>
      </ToastProvider>
    </RuntimeProvider>
  )
}
