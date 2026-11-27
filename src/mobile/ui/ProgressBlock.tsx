import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './ProgressBlock.module.css'

/**
 * 进度（mockup `.progress-block` / `.progress`）：轨道 6 高、999 圆角、`--fill` 底，
 * 填充 `--brand`。确定进度给 0–100 的 value；不知道总量时铺满斜纹并滚动。
 * `tight` 去掉上距 16，供提示条里的附件进度复用（上传中的那条 notice）。
 */
export interface ProgressBlockProps {
  /** 正在做什么；例如“正在打包会话与附件…” */
  label?: ReactNode
  /** 0–100；不传或传 null 就是不确定进度 */
  value?: number | null
  /** 左下角大小文案（12.4 MB / 20.0 MB） */
  sizeText?: ReactNode
  /** 右下角剩余时间（约 8 秒） */
  remaining?: ReactNode
  /** 塞进提示条时不带上距 */
  tight?: boolean
  className?: string
}

export const ProgressBlock = ({
  label,
  value,
  sizeText,
  remaining,
  tight = false,
  className,
}: ProgressBlockProps) => {
  const indeterminate = value === undefined || value === null
  const percent = indeterminate ? 0 : Math.min(100, Math.max(0, value))
  return (
    <div className={cx(styles.block, tight ? styles.tight : '', className)}>
      {label || !indeterminate ? (
        <div className={styles.head}>
          <span className={styles.label}>{label}</span>
          {indeterminate ? null : <span className={styles.value}>{`${Math.round(percent)}%`}</span>}
        </div>
      ) : null}
      <div
        className={cx(styles.progress, indeterminate ? styles.indeterminate : '')}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      >
        <span className={styles.bar} style={indeterminate ? undefined : { width: `${percent}%` }} />
      </div>
      {sizeText || remaining ? (
        <div className={styles.foot}>
          <span>{sizeText}</span>
          <span>{remaining}</span>
        </div>
      ) : null}
    </div>
  )
}
