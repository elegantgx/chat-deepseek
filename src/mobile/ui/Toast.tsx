import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Toast.module.css'

/**
 * 轻提示的纯展示件（`app/toast.tsx` 负责排队与自动消失，样式同源）。
 * 底部悬浮、最大宽度留 36、`--text` 底 `--bg` 字，触摸不拦截。
 * 文案由调用方传入，必须已经过 i18n。
 */
export interface ToastProps {
  message: ReactNode
  className?: string
}

export const Toast = ({ message, className }: ToastProps) => (
  <div className={cx(styles.toast, className)} role="status" aria-live="polite">
    {message}
  </div>
)
