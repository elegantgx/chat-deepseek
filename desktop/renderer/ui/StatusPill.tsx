import styles from './StatusPill.module.css'
import { cx } from './cx'

export type StatusKind = 'running' | 'stopped' | 'error'

const DEFAULT_LABEL: Record<StatusKind, string> = {
  running: '运行中',
  stopped: '已停止',
  error: '错误',
}

export interface StatusPillProps {
  status: StatusKind
  /** 默认按状态取「运行中 / 已停止 / 错误」；需要别的文案时显式传 */
  label?: string
  className?: string
}

export function StatusPill({ status, label, className }: StatusPillProps) {
  return (
    <span className={cx(styles.pill, styles[status], className)}>
      <span className={styles.dot} aria-hidden="true" />
      {label ?? DEFAULT_LABEL[status]}
    </span>
  )
}
