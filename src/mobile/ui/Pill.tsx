import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Pill.module.css'

/**
 * 状态胶囊与标记（mockup `.pill` / `.badge`）。
 * 语义固定：running = 绿、stopped = 灰、error = 红、muted = 弱化底；
 * badge 是标签而不是状态，用品牌淡底，不参与状态语义。
 */
export type PillTone = 'muted' | 'running' | 'stopped' | 'error' | 'brand'

export interface PillProps {
  tone?: PillTone
  /** 前置 6px 状态点；颜色跟随 currentColor */
  dot?: boolean
  children: ReactNode
  className?: string
}

export const Pill = ({ tone = 'muted', dot = false, children, className }: PillProps) => (
  <span className={cx(styles.pill, styles[tone], className)}>
    {dot ? <span className={styles.dot} /> : null}
    {children}
  </span>
)

export interface BadgeProps {
  children: ReactNode
  className?: string
}

/** “当前”这类标记：20 高、8 圆角、品牌淡底（mockup `.badge`） */
export const Badge = ({ children, className }: BadgeProps) => (
  <span className={cx(styles.badge, className)}>{children}</span>
)
