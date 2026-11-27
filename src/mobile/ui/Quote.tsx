import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Quote.module.css'

/**
 * 引用块：左侧 2px 品牌淡线 + 12 内缩，14/22 `--ink-2`。
 * 示意里没有引用样式，沿用思考块“细线挂内容”的语言，避免正文里再出现一张卡片。
 */
export interface QuoteProps {
  children: ReactNode
  className?: string
}

export const Quote = ({ children, className }: QuoteProps) => (
  <blockquote className={cx(styles.quote, className)}>{children}</blockquote>
)
