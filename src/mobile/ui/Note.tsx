import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Note.module.css'

/**
 * 分组下方的说明（mockup `.loop-note`）：12/18 `--ink-3`，上距 24、左缩进 17，
 * 与卡片内行的文字起点对齐。危险说明（初始化失败原因、连不上服务器）用 `danger`。
 */
export interface NoteProps {
  children: ReactNode
  danger?: boolean
  className?: string
}

export const Note = ({ children, danger = false, className }: NoteProps) => (
  <p className={cx(styles.note, danger ? styles.danger : '', className)}>{children}</p>
)

/**
 * “需要准备”清单行（mockup `.prep-row`）：52 高、左 16、5px 弱圆点 + 16/22 文字。
 * 用于添加远程服务器等一次性的准备条件列表，放进 Card 里直接排。
 */
export const PrepRow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx(styles.prep, className)}>
    <span className={styles.dot} aria-hidden="true" />
    <span>{children}</span>
  </div>
)
