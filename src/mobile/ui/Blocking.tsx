import type { ReactNode } from 'react'
import { cx } from './cx.js'
import { Spinner } from './Spinner.js'
import styles from './Blocking.module.css'

/**
 * 阻塞遮罩（mockup `.blocking`）：弹窗问“要不要做”，这里表达“正在做、别动”。
 * 盖住整页、不给取消，只说清在做什么和为什么不能退出；层级压在弹层与抽屉之上。
 * fixed 层自己补上下安全区，卡片不会顶到刘海或手势条。
 */
export interface BlockingProps {
  title: ReactNode
  note?: ReactNode
  /** 默认 24 转圈；也可以换成别的语义图标 */
  icon?: ReactNode
  /** 额外内容，例如不确定进度条 */
  children?: ReactNode
  className?: string
}

export const Blocking = ({ title, note, icon, children, className }: BlockingProps) => (
  <div
    className={cx(styles.layer, className)}
    role="alertdialog"
    aria-modal="true"
    aria-busy="true"
  >
    <div className={styles.card}>
      <div className={styles.icon}>{icon ?? <Spinner size="lg" />}</div>
      <p className={styles.title}>{title}</p>
      {note ? <p className={styles.note}>{note}</p> : null}
      {children}
    </div>
  </div>
)
