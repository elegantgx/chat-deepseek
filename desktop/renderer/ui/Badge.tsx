import type { ReactNode } from 'react'
import styles from './Badge.module.css'
import { cx } from './cx'

/** 徽章：强调色 12% 底，用于「管理员 / 当前登录」这类短标记。 */
export interface BadgeProps {
  children: ReactNode
  className?: string
}

export function Badge({ children, className }: BadgeProps) {
  return <span className={cx(styles.badge, className)}>{children}</span>
}
