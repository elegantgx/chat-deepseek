import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './CodeBlock.module.css'

/**
 * 代码块外壳：语言标签在左上、行内动作（复制）在右上，代码等宽 13/20 横向滚动。
 * 高亮由屏里的 Markdown 渲染器负责，这里只保证边距、圆角、底色与滚动不破版。
 * 示意里没有代码块样式，沿用填充色语言（`--fill-2` + 12 圆角）。
 */
export interface CodeBlockProps {
  code: string
  language?: string
  /** 右上角动作，例如复制按钮 */
  actions?: ReactNode
  className?: string
}

export const CodeBlock = ({ code, language, actions, className }: CodeBlockProps) => (
  <div className={cx(styles.block, className)}>
    {language || actions ? (
      <div className={styles.head}>
        <span className={styles.language}>{language}</span>
        {actions}
      </div>
    ) : null}
    <pre className={styles.pre}>
      <code>{code}</code>
    </pre>
  </div>
)
