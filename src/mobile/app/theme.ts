/**
 * mobile 的设计 token，数值逐字来自 `docs/android/mockups/mockup.css` 的 `:root`
 * 与暗色块；只搬变量，不改数值。`docs/android-visual.md` §2 是同一张表的说明。
 *
 * token 由 JS 注入 `<style>`（任务要求主题在 theme.ts 里生成），这样明暗两套只存在一处；
 * 组件一律写 `var(--…)`，不写死颜色。
 */

export type Theme = 'light' | 'dark'
export type ThemePreference = 'light' | 'dark' | 'system'

const LIGHT_TOKENS: Record<string, string> = {
  '--bg': '#ffffff',
  '--text': '#0f1115',
  '--text-2': '#61666b',
  '--text-3': '#81858c',
  '--caption': '#adb2b8',
  '--brand': '#3964fe',
  '--brand-soft': '#edf3fe',
  '--brand-line': '#b7c8fe',
  '--border': 'rgba(0, 0, 0, 0.1)',
  '--border-soft': 'rgba(0, 0, 0, 0.04)',
  '--danger': '#ec1313',
  // 追加段（示意 §5.1 缺状态）新增的三个语义色，值来自 mockup.css 的追加 :root
  '--danger-soft': 'rgba(236, 19, 19, 0.08)',
  '--warn': '#b45309',
  '--warn-soft': 'rgba(180, 83, 9, 0.08)',
  '--green': '#22c55e',
  '--fill': '#f1f2f4',
  '--ink-2': '#6b6b70',
  '--ink-3': '#8a8a8f',
  '--ink-4': '#b3b3b8',
  '--fill-2': '#f5f5f5',
  '--fill-3': '#eceef1',
  '--chip-fill': '#ededef',
  '--line': '#e3e3e8',
  '--ring': '#c6c6cc',
  '--track': '#e0e0e5',
  '--tick': '#d2d2d8',
  '--dot-mute': '#c2c2c7',
  '--green-ink': '#15803d',
  '--pending-line': '#d8d8dd',
  '--group-bg': '#f7f8fa',
  '--card': '#ffffff',
  '--bubble': '#edf3fe',
  '--font-ui':
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans CJK SC', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  '--font-mono': "ui-monospace, 'Roboto Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
  '--shadow-composer':
    '0 4px 12px 0 rgba(0, 0, 0, 0.02), 0 2px 2px 0 rgba(72, 104, 178, 0.01), 0 30px 60px 0 rgba(72, 104, 178, 0.03)',
}

/** 暗色只覆盖颜色；字体、阴影（置 none）按 mockup 的暗色块来 */
const DARK_OVERRIDES: Record<string, string> = {
  '--bg': '#151517',
  '--text': '#f9fafb',
  '--text-2': '#cfd3d6',
  '--text-3': '#adb2b8',
  '--caption': '#81858c',
  '--brand': '#5686fe',
  '--brand-soft': '#283142',
  '--brand-line': '#34415b',
  '--border': 'rgba(255, 255, 255, 0.12)',
  '--border-soft': 'rgba(255, 255, 255, 0.06)',
  '--danger': '#f25a5a',
  '--danger-soft': 'rgba(242, 90, 90, 0.14)',
  '--warn': '#f0b35e',
  '--warn-soft': 'rgba(240, 179, 94, 0.14)',
  '--fill': '#353638',
  '--fill-2': '#353638',
  '--fill-3': '#3a3b3f',
  '--chip-fill': '#3a3b3f',
  '--group-bg': '#151517',
  '--card': '#2c2c2e',
  '--bubble': '#283142',
  '--ink-2': '#c3c7cd',
  '--ink-3': '#a2a7ad',
  '--ink-4': '#7e828a',
  '--line': '#3d3e42',
  '--ring': '#55585f',
  '--track': '#3a3b3f',
  '--tick': '#55585f',
  '--dot-mute': '#5a5d63',
  '--green-ink': '#4ed17e',
  '--pending-line': '#3d3e42',
  '--shadow-composer': 'none',
}

const DARK_TOKENS: Record<string, string> = { ...LIGHT_TOKENS, ...DARK_OVERRIDES }

const STYLE_ID = 'mobile-theme'

export const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')

export const resolveTheme = (preference: ThemePreference, prefersDark: boolean): Theme =>
  preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference

const declarations = (tokens: Record<string, string>): string =>
  Object.entries(tokens)
    .map(([name, value]) => `${name}:${value};`)
    .join('')

/** 首屏之前注入两套 token；重复调用无副作用 */
export const installTheme = (): void => {
  if (document.getElementById(STYLE_ID)) {
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = [
    `:root{${declarations(LIGHT_TOKENS)}color-scheme:light;}`,
    `[data-theme='dark']{${declarations(DARK_TOKENS)}color-scheme:dark;}`,
  ].join('\n')
  document.head.append(style)
}

/** 把解析后的主题写到 `<html>`；同步更新浏览器/WebView 的 theme-color */
export const applyTheme = (theme: Theme): void => {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const background = getComputedStyle(root).getPropertyValue('--bg').trim() || LIGHT_TOKENS['--bg']
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
}
