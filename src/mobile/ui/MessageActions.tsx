import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './MessageActions.module.css'

/**
 * 消息行内动作的最小外壳（复制、重试、重新生成）：
 * 28 高、8 圆角、12/18 `--ink-3`，图标 14；触摸目标比行本身大，排成一行不抢正文。
 * 图标由屏传入，文案/图标都走调用方的 i18n。
 */
export interface MessageActionsProps {
  children: ReactNode
  className?: string
}

export const MessageActions = ({ children, className }: MessageActionsProps) => (
  <div className={cx(styles.row, className)}>{children}</div>
)

export interface MessageActionProps {
  icon?: ReactNode
  children?: ReactNode
  onClick?: () => void
  /** 读屏名；有文字时也建议给，避免图标语义丢失 */
  label: string
  danger?: boolean
  className?: string
}

export const MessageAction = ({
  icon,
  children,
  onClick,
  label,
  danger = false,
  className,
}: MessageActionProps) => (
  <button
    type="button"
    aria-label={label}
    className={cx(styles.action, danger ? styles.danger : '', className)}
    onClick={onClick}
  >
    {icon}
    {children ? <span>{children}</span> : null}
  </button>
)
