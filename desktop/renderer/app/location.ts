import { DEFAULT_PAGE, isPageId } from './nav'
import type { PageId } from './nav'
import type { ThemeChoice } from './theme'

export interface Route {
  page: PageId
  /** hash 里钉住的主题，仅供截图脚本使用；正常运行时为 undefined */
  theme?: ThemeChoice
}

const THEMES = new Set<ThemeChoice>(['light', 'dark', 'system'])

/**
 * hash 既是页面路由，也是截图脚本的开关：`#backup`、`#settings-dark`、`#dark`。
 * 页面 id 里不含 `-`，所以按第一个 `-` 切开不会歧义。
 */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').trim()
  if (!raw) {
    return { page: DEFAULT_PAGE }
  }
  const [head, tail] = raw.split('-', 2)
  const theme = tail && THEMES.has(tail as ThemeChoice) ? (tail as ThemeChoice) : undefined
  if (isPageId(head)) {
    return { page: head, theme }
  }
  if (THEMES.has(head as ThemeChoice)) {
    return { page: DEFAULT_PAGE, theme: head as ThemeChoice }
  }
  return { page: DEFAULT_PAGE }
}

export function navigate(page: PageId): void {
  window.location.hash = page
}
