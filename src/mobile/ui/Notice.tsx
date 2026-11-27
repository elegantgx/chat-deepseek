import type { ReactNode } from 'react'
import { cx } from './cx.js'
import { InfoIcon, WarnIcon } from './icons.js'
import styles from './Notice.module.css'

/**
 * 整块提示条（mockup `.notice`）：带图标、可换行、右侧可选动作。
 * 三档语义固定：红 = 失败，琥珀 = 有代价但还能继续，蓝 = 说明。
 * 输入框下面的校验红字不用它（那是字段自己的 error）。
 */
export type NoticeTone = 'error' | 'warn' | 'info'

export interface NoticeAction {
  label: string
  onClick: () => void
}

export interface NoticeProps {
  tone: NoticeTone
  children: ReactNode
  /** 覆盖默认图标（错误/警告 = 警告三角，信息 = info）；传 false 可不要图标 */
  icon?: ReactNode | false
  /** 文字动作；可给多个（上传失败就是“重试 + 移除”） */
  actions?: NoticeAction[]
  /** 正文长 + 带动作时改为上下排：动作换到正文下一行靠右（示意 .notice.is-stacked） */
  stacked?: boolean
  className?: string
}

const defaultIcon = (tone: NoticeTone): ReactNode =>
  tone === 'info' ? <InfoIcon size={16} /> : <WarnIcon size={16} />

export const Notice = ({
  tone,
  children,
  icon,
  actions,
  stacked = false,
  className,
}: NoticeProps) => (
  <div
    className={cx(styles.notice, styles[tone], stacked ? styles.stacked : '', className)}
    role="status"
    data-notice="true"
  >
    {icon === false ? null : <span className={styles.icon}>{icon ?? defaultIcon(tone)}</span>}
    <div className={styles.text}>{children}</div>
    {actions?.length ? (
      <div className={styles.actions}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={styles.action}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null}
  </div>
)

/**
 * 聊天页顶栏下方的整块提示容器（mockup `.chat-notice`）：左右 16 与消息区同宽，
 * 上 16 和顶栏拉开、下 8 不贴第一条消息。里面直接放 Notice。
 */
export const ChatNotice = ({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) => <div className={cx(styles.chatNotice, className)}>{children}</div>
