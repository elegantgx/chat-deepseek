import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Card.module.css'

/**
 * 设置类页面的卡片（mockup `.settings-card` / `.status-card` / `.form-card` / `.server-option`）。
 * 默认不带内边距：行自己带 0 17；状态卡、表单卡、服务器选项的内边距不同，
 * 用 `padding` 选，避免各屏再往卡片上叠一层自造 padding。
 */
export interface CardProps {
  children: ReactNode
  /** 分组标签；不传就是一张不带标签的卡 */
  label?: string
  /** 独立卡（例如“退出登录”）与上方内容留 30，而不是组间距 24 */
  standalone?: boolean
  /** 与上一块的间距（px）。示意里无标签卡常用 24、表单卡 12/16、带标签组 28 */
  gap?: number
  /** 无 / 状态卡 16 17 / 表单卡 16 / 服务器选项 20 */
  padding?: 'none' | 'status' | 'form' | 'option'
  className?: string
  style?: CSSProperties
}

export const Card = ({
  children,
  label,
  standalone = false,
  gap,
  padding = 'none',
  className,
  style,
}: CardProps) => {
  const card = (
    <div
      className={cx(
        styles.card,
        padding === 'status' ? styles.padStatus : '',
        padding === 'form' ? styles.padForm : '',
        padding === 'option' ? styles.padOption : '',
        !label && standalone ? styles.standalone : '',
        className
      )}
      style={style}
    >
      {children}
    </div>
  )
  if (!label) {
    return gap === undefined ? card : <div style={{ marginTop: gap }}>{card}</div>
  }
  return (
    <section className={styles.group} style={gap === undefined ? undefined : { marginTop: gap }}>
      <h2 className={styles.label}>{label}</h2>
      {card}
    </section>
  )
}
