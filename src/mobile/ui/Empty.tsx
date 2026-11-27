import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Empty.module.css'

/**
 * 空态块（mockup `.empty`）：56 圆弱底图标 + 15/600 标题 + 最多 260 宽的说明 + 可选动作。
 * 不做整屏插画：放进卡片或内容区都成立，尺度与行、卡片同一套。
 * 动作按钮请用 Button size="xs"（40 高胶囊，示意 `.empty .btn`）。
 */
export interface EmptyProps {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export const Empty = ({ icon, title, description, action, className }: EmptyProps) => (
  <div className={cx(styles.empty, className)}>
    <div className={styles.icon}>{icon}</div>
    <div className={styles.title}>{title}</div>
    {description ? <p className={styles.description}>{description}</p> : null}
    {action ? <div className={styles.action}>{action}</div> : null}
  </div>
)
