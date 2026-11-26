import type { ReactNode } from 'react'
import styles from './Card.module.css'
import { cx } from './cx'

export interface CardProps {
  children: ReactNode
  className?: string
  /** 撑满父级剩余高度（表格 / 日志页用） */
  grow?: boolean
  /** 圆角内裁切，避免表头 / 日志溢出卡片 */
  clip?: boolean
}

export function Card({ children, className, grow, clip }: CardProps) {
  return (
    <section className={cx(styles.card, grow && styles.grow, clip && styles.clip, className)}>
      {children}
    </section>
  )
}

export interface CardHeaderProps {
  title: ReactNode
  /** 右侧弱信息（数量、版本、mono 文案） */
  meta?: ReactNode
  /** 右侧操作区 */
  actions?: ReactNode
  className?: string
}

export function CardHeader({ title, meta, actions, className }: CardHeaderProps) {
  return (
    <header className={cx(styles.header, className)}>
      <h2 className={styles.title}>{title}</h2>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}

export interface CardFooterProps {
  children?: ReactNode
  /** 推到右侧的收口信息（与 children 二选一或并用） */
  end?: ReactNode
  className?: string
}

export function CardFooter({ children, end, className }: CardFooterProps) {
  return (
    <footer className={cx(styles.footer, className)}>
      {children}
      {end ? <span className={styles.end}>{end}</span> : null}
    </footer>
  )
}
