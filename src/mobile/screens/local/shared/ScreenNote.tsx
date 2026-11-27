import type { ReactNode } from 'react'
import styles from './ScreenNote.module.css'

/**
 * 状态卡下方的一行说明（示意 `.loop-note`）：12/18、左缩进 17、上距 24。
 * 失败原因沿用同一位置，只把颜色换成危险色（示意 `.loop-note.is-danger`）。
 */
export const ScreenNote = ({
  children,
  danger = false,
}: {
  children: ReactNode
  danger?: boolean
}) => <p className={danger ? `${styles.note} ${styles.danger}` : styles.note}>{children}</p>
