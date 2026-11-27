import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './ChatBubble.module.css'

/**
 * 消息气泡（mockup `.msg-user .bubble` / `.msg-assistant`）：
 * - 用户：靠右、`--bubble` 底、22 圆角、10 16 内边距、16/24，最大宽 = 100% - 68；
 * - 助手：无气泡底、16/26，上距 20、下留 8。
 * 内容本身（Markdown、代码块、思考块）由屏传入，这里只管气泡壳与间距。
 */
export interface UserBubbleProps {
  children: ReactNode
  className?: string
}

export const UserBubble = ({ children, className }: UserBubbleProps) => (
  <div className={cx(styles.user, className)}>
    <div className={styles.bubble}>{children}</div>
  </div>
)

export interface AssistantMessageProps {
  children: ReactNode
  /** 复制/重试用 MessageActions；放在正文下 8 */
  actions?: ReactNode
  className?: string
}

export const AssistantMessage = ({ children, actions, className }: AssistantMessageProps) => (
  <div className={cx(styles.assistant, className)}>
    {children}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </div>
)
