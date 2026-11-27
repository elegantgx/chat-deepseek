import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './ActionRow.module.css'

/**
 * 失败/空态下的“说明 + 次级动作”行（mockup `.action-row`）：
 * 一行说明占满左侧，右侧一个或两个字按钮（`.text-btn`，用 Button variant="text"）。
 * 比整宽主按钮轻，不会抢走页面唯一的视觉重点。
 */
export interface ActionRowProps {
  text?: ReactNode
  children: ReactNode
  className?: string
}

export const ActionRow = ({ text, children, className }: ActionRowProps) => (
  <div className={cx(styles.row, className)} data-action-row="true">
    <span className={styles.text}>{text}</span>
    {children}
  </div>
)
