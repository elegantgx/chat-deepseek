import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './KvRow.module.css'

/**
 * 状态卡里的键值区（mockup `.kv-list` / `.kv`）：13/18、间距 10、上距 15。
 * 值默认等宽 12.5 右对齐（地址、版本、目录），纯文字值（账户名）用 mono={false}。
 */
export interface KvListProps {
  children: ReactNode
  className?: string
}

export const KvList = ({ children, className }: KvListProps) => (
  <div className={cx(styles.list, className)}>{children}</div>
)

export interface KvRowProps {
  label: ReactNode
  value: ReactNode
  /** 值用等宽字体；账户名这类纯文字传 false */
  mono?: boolean
  className?: string
}

export const KvRow = ({ label, value, mono = true, className }: KvRowProps) => (
  <div className={cx(styles.row, className)}>
    <span className={styles.label}>{label}</span>
    <span className={cx(styles.value, mono ? '' : styles.text)}>{value}</span>
  </div>
)
