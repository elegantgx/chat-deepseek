import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Auth.module.css'

/**
 * 认证页大标题（mockup `.auth-title`）：25/600/32、上距 44、居中、字距 -0.01em。
 * 登录、管理会话过期、远程登录共用；页面左右留白由 PageBody pad="auth" 决定。
 */
export const AuthTitle = ({ children, className }: { children: ReactNode; className?: string }) => (
  <h1 className={cx(styles.title, className)}>{children}</h1>
)

/**
 * 登录页顶部的服务器胶囊（mockup `.login-server`）：与输入框同一形状语言
 * （56 高 / 28 圆角 / `--fill-2` 底 / 左右 20），名字等宽 15、右侧连接状态 12.5。
 * 传 icon（地球/本机）与已翻译的状态文案；状态点固定 6px。
 */
export interface ServerChipProps {
  icon?: ReactNode
  name: ReactNode
  /** 已翻译的状态文案，如“已连接”“运行中” */
  statusLabel: ReactNode
  tone?: 'online' | 'offline'
  className?: string
}

export const ServerChip = ({
  icon,
  name,
  statusLabel,
  tone = 'online',
  className,
}: ServerChipProps) => (
  <div className={cx(styles.serverChip, className)}>
    {icon ? <span className={styles.serverIcon}>{icon}</span> : null}
    <span className={styles.serverName}>{name}</span>
    <span className={cx(styles.serverStatus, tone === 'offline' ? styles.offline : '')}>
      <span className={styles.dot} />
      {statusLabel}
    </span>
  </div>
)
