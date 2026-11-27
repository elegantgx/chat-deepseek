import type { ReactNode } from 'react'
import { Spinner } from '../../ui/index.js'
import styles from './RowStatus.module.css'

/**
 * 行内进行中 / 失败状态（mockup `.row-status`）：转圈或 6px 圆点 + 12/16 文案。
 * 备份删除、导出、导入失败都复用这一份，避免每个屏各写一套颜色。
 */
export type RowStatusTone = 'busy' | 'error'

export interface RowStatusProps {
  tone: RowStatusTone
  children: ReactNode
}

export const RowStatus = ({ tone, children }: RowStatusProps) => (
  <span className={`${styles.status} ${tone === 'busy' ? styles.busy : styles.error}`}>
    {tone === 'busy' ? <Spinner size="sm" /> : <span className={styles.dot} />}
    <span>{children}</span>
  </span>
)
