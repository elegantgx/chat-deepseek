import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './StatusHead.module.css'

/**
 * 状态卡头部（mockup `.status-head`）：10px 圆点 + 24/600 状态字 + 右侧胶囊。
 * 圆点语义固定：运行/已连接 = 绿，未初始化/已停止 = 灰，
 * 准备/连接中 = 品牌蓝，失败/断开 = 红（visual §5.6）。
 */
export type StatusTone = 'ok' | 'idle' | 'busy' | 'failed'

export interface StatusHeadProps {
  tone: StatusTone
  children: ReactNode
  /** 右侧 24 高胶囊（内置后端 / 远程） */
  pill?: ReactNode
  className?: string
}

export const StatusHead = ({ tone, children, pill, className }: StatusHeadProps) => (
  <div className={cx(styles.head, className)}>
    <span className={cx(styles.dot, tone === 'ok' ? '' : styles[tone])} aria-hidden="true" />
    <span className={styles.text}>{children}</span>
    {pill ? <span className={styles.pill}>{pill}</span> : null}
  </div>
)

/** 单独用圆点（步骤/列表里的状态位）时的同一套颜色 */
export const StatusDot = ({ tone }: { tone: StatusTone }) => (
  <span className={cx(styles.dot, tone === 'ok' ? '' : styles[tone])} aria-hidden="true" />
)

/** 状态卡动作区（mockup `.status-actions`）：按钮等高并排、间距 10、上距 16 */
export const StatusActions = ({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) => <div className={cx(styles.actions, className)}>{children}</div>
