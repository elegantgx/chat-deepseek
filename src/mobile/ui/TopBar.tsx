import type { ReactNode } from 'react'
import { translate } from '../../i18n/index.js'
import { cx } from './cx.js'
import { BackIcon } from './icons.js'
import styles from './TopBar.module.css'

/**
 * 二级页顶栏（visual §3）：56 高、左右 18、`34px 1fr 34px`，标题真正居中。
 * 返回键只有一级，34 圆、`--chip-fill` 底、18 图标、线宽 2.6。
 * 启动/初始化期间不能退回时传 backDisabled：只降透明度，不换成灰底。
 */
export interface TopBarProps {
  title: ReactNode
  onBack?: () => void
  backDisabled?: boolean
  right?: ReactNode
  className?: string
}

export const TopBar = ({ title, onBack, backDisabled = false, right, className }: TopBarProps) => (
  <header className={cx(styles.bar, className)}>
    {onBack ? (
      <button
        type="button"
        className={styles.back}
        aria-label={translate('mobileBack')}
        disabled={backDisabled}
        onClick={onBack}
      >
        <BackIcon size={18} />
      </button>
    ) : (
      <span />
    )}
    <h1 className={styles.title}>{title}</h1>
    <div className={styles.right}>{right}</div>
  </header>
)

/**
 * 聊天页顶栏（mockup `.chat-header`）：60 高、12 10 4 内边距，
 * 左菜单 / 右新建由调用方传 IconButton；中间标题 14/500、两侧留 8。
 * `status` 放断线、重连这类连接状态，塞在标题与右侧动作之间。
 */
export interface ChatTopBarProps {
  /** 欢迎空态没有标题，此时只留弹性空位把右侧动作顶到右边 */
  title?: ReactNode
  left?: ReactNode
  right?: ReactNode
  status?: ReactNode
  className?: string
}

export const ChatTopBar = ({ title, left, right, status, className }: ChatTopBarProps) => (
  <header className={cx(styles.chatBar, className)}>
    {left}
    <div className={styles.chatTitle}>{title}</div>
    {status}
    {right ? <div className={styles.chatActions}>{right}</div> : null}
  </header>
)
