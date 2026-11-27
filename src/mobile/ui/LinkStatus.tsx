import type { ReactNode } from 'react'
import { cx } from './cx.js'
import { Spinner } from './Spinner.js'
import styles from './LinkStatus.module.css'

/**
 * 连接状态（mockup `.link-status`）：6px 点 + 12px 说明。
 * 语义分四档：online 绿、connecting 品牌蓝闪、reconnecting 琥珀闪、offline 红。
 * 重连用警告色而不是红色：这是可自愈的过程，最终失败才用 offline。
 * `spinner` 用于“正在导出”这类没有连接语义、但也在进行中的行内状态。
 */
export type LinkTone = 'online' | 'connecting' | 'reconnecting' | 'offline'

export interface LinkStatusProps {
  tone?: LinkTone
  spinner?: boolean
  /** 独立成行：上下 12、占满宽度（示意 .link-status.is-row），不借 kv-list 的 gap */
  row?: boolean
  children: ReactNode
  className?: string
}

export const LinkStatus = ({
  tone = 'online',
  spinner = false,
  row = false,
  children,
  className,
}: LinkStatusProps) => (
  <span
    className={cx(
      styles.link,
      row ? styles.row : '',
      tone === 'online' ? '' : styles[tone],
      className
    )}
  >
    {spinner ? <Spinner size="sm" /> : <span className={styles.dot} />}
    <span>{children}</span>
  </span>
)
