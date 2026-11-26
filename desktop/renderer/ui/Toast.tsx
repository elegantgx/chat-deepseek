import type { ReactNode } from 'react'
import { CheckCircleIcon, XCircleIcon } from './icons'
import styles from './Toast.module.css'
import { cx } from './cx'

export type ToastTone = 'success' | 'error'

export interface ToastProps {
  tone: ToastTone
  children: ReactNode
  className?: string
}

/**
 * 内容层之外唯一的轻量浮层。自动消失属于页面节奏，组件不接管定时器，也不阻塞操作。
 */
export function Toast({ tone, children, className }: ToastProps) {
  return (
    <div
      className={cx(styles.toast, styles[tone], className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {tone === 'success' ? <CheckCircleIcon size={16} /> : <XCircleIcon size={16} />}
      <span>{children}</span>
    </div>
  )
}
