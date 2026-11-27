import type { ReactNode } from 'react'
import { translate } from '../../i18n/index.js'
import { cx } from './cx.js'
import styles from './Sheet.module.css'

/**
 * 底部弹层容器（visual §5.4 的面板语言）：顶部 24 圆角、`--card` 底、36×4 grabber。
 * 具体内容（滑轨、单选行）由函数大小/外观/语言屏自己排。
 * 底部补 `env(safe-area-inset-bottom)`：fixed 层不受 Shell 的 padding 影响。
 */
export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  label?: string
}

export const Sheet = ({ open, onClose, title, subtitle, children, label }: SheetProps) => {
  if (!open) {
    return null
  }
  return (
    <div className={styles.layer}>
      <button
        type="button"
        className={styles.scrim}
        aria-label={translate('close')}
        onClick={onClose}
      />
      <section
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? translate('close')}
      >
        <span className={styles.grabber} aria-hidden="true" />
        {title ? <h2 className={styles.title}>{title}</h2> : null}
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        <div className={styles.body}>{children}</div>
      </section>
    </div>
  )
}

/**
 * 弹层里的整行动作（mockup `.sheet-action`）：56 高、左对齐、16px；
 * 会话/账户的“重命名、删除”这类动作列表直接用它，不再各自写行高。
 */
export interface SheetActionProps {
  children: ReactNode
  onClick?: () => void
  danger?: boolean
  className?: string
}

export const SheetAction = ({ children, onClick, danger = false, className }: SheetActionProps) => (
  <button
    type="button"
    className={cx(styles.action, danger ? styles.actionDanger : '', className)}
    onClick={onClick}
  >
    {children}
  </button>
)
