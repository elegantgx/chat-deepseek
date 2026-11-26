import type { ReactNode } from 'react'
import { InboxIcon } from './icons'
import styles from './EmptyState.module.css'
import { cx } from './cx'

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  /** 默认收件盘图标；传 Database 之类更贴近场景的图标 */
  icon?: ReactNode
  /** 可选的下一步操作（按钮 / 文字链接） */
  action?: ReactNode
  /** 紧凑内边距，放进表格空行 / 总览样例时用 */
  compact?: boolean
  className?: string
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, compact && styles.compact, className)}>
      <span className={styles.icon} aria-hidden="true">
        {icon ?? <InboxIcon />}
      </span>
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
