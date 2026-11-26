import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/** 用户的主题选择；`system` 跟随系统偏好 */
export type ThemeChoice = 'light' | 'dark' | 'system'
/** 实际生效的主题：组件只关心这个，写进 `<html data-theme>` */
export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

interface ThemeValue {
  choice: ThemeChoice
  resolved: ResolvedTheme
  setChoice: (choice: ThemeChoice) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches
}

function resolve(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === 'system') {
    return systemDark ? 'dark' : 'light'
  }
  return choice
}

/**
 * 主题状态放在渲染层内存里，不落盘：持久化要走 ipc 的 config，等接上真后端再说。
 * 初始值可由调用方指定，截图脚本借此钉住主题。
 */
export function ThemeProvider({
  children,
  initial = 'system',
}: {
  children: ReactNode
  initial?: ThemeChoice
}) {
  const [choice, setChoiceState] = useState<ThemeChoice>(initial)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches)
    }
    query.addEventListener('change', onChange)
    return () => {
      query.removeEventListener('change', onChange)
    }
  }, [])

  const resolved = resolve(choice, systemDark)

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
  }, [])

  const value = useMemo<ThemeValue>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved, setChoice]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** 读当前主题；必须在 ThemeProvider 内使用 */
export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) {
    throw new Error('useTheme 必须在 ThemeProvider 内使用')
  }
  return value
}
