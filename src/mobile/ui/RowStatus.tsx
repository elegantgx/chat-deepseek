import type { ReactNode } from 'react'
import { cx } from './cx.js'
import { Spinner } from './Spinner.js'
import styles from './RowStatus.module.css'

/**
 * 列表行右侧的行内状态（mockup `.row-status`）：转圈或 6px 圆点 + 12/16 文字。
 * 进行中用品牌色 + 转圈，失败用危险色 + 圆点，默认三级文字色。
 * 它不管“连接还能不能用”（那是 LinkStatus），只管某一行正在做什么。
 */
export type RowStatusTone = 'neutral' | 'busy' | 'error'

export interface RowStatusProps {
  children: ReactNode
  tone?: RowStatusTone
  /** 默认进行中用转圈、其余用圆点；也可显式指定 */
  spinner?: boolean
  className?: string
}

export const RowStatus = ({ children, tone = 'neutral', spinner, className }: RowStatusProps) => {
  const useSpinner = spinner ?? tone === 'busy'
  return (
    <span className={cx(styles.status, tone === 'neutral' ? '' : styles[tone], className)}>
      {useSpinner ? <Spinner size="sm" /> : <span className={styles.dot} />}
      <span>{children}</span>
    </span>
  )
}
