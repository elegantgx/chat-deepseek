import { useState } from 'react'
import type { ReactNode } from 'react'
import { cx } from './cx.js'
import { ChevronRightIcon, ThinkIcon } from './icons.js'
import styles from './ThinkingBlock.module.css'

/**
 * 思考过程折叠块。示意里没有展开态（36 屏只锁聊天静态外观），
 * 这里按官方实现的语言补最小壳：13/20 的行头 + 14/22 的正文，正文用左侧细线挂住，
 * 不抢正文的层级；展开箭头只在有内容时旋转。
 */
export interface ThinkingBlockProps {
  /** 行头文案，例如“已深度思考（用时 12 秒）” */
  label: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}

export const ThinkingBlock = ({
  label,
  children,
  defaultOpen = false,
  className,
}: ThinkingBlockProps) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cx(styles.block, className)}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ThinkIcon size={14} className={styles.icon} />
        <span className={styles.label}>{label}</span>
        <ChevronRightIcon
          size={14}
          className={cx(styles.chevron, open ? styles.chevronOpen : '')}
        />
      </button>
      {open ? <div className={styles.body}>{children}</div> : null}
    </div>
  )
}
