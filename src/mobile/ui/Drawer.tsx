import type { ReactNode } from 'react'
import { translate } from '../../i18n/index.js'
import { cx } from './cx.js'
import { MoreIcon } from './icons.js'
import { IconButton } from './IconButton.js'
import { SearchField } from './SearchField.js'
import styles from './Drawer.module.css'

/**
 * 会话抽屉容器（visual §3）：宽 310、贴左、全高，底下一层 32% 黑遮罩。
 * 抽屉内部的搜索、分组、会话行、底部账户都在这个文件里，36 屏只组合，
 * 不再各自写一遍 50/14/26 这些尺寸。
 */
export interface DrawerProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** 无障碍名称；默认“会话历史”由调用方传已翻译文案 */
  label?: string
}

export const Drawer = ({ open, onClose, children, label }: DrawerProps) => {
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
      <aside className={styles.panel} aria-label={label}>
        {children}
      </aside>
    </div>
  )
}

/** 抽屉搜索胶囊：定位按示意 50 / 22 / 24，搜索框本体复用 SearchField */
export interface DrawerSearchProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
}

export const DrawerSearch = ({ className, onChange, ...rest }: DrawerSearchProps) => (
  <div className={cx(styles.searchDock, className)}>
    <SearchField onChange={(event) => onChange?.(event.target.value)} {...rest} />
  </div>
)

/** 抽屉列表区：14 上距、左右 12，自己滚动 */
export const DrawerBody = ({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) => <div className={cx(styles.body, className)}>{children}</div>

/**
 * 分组头（mockup `.section-head`）：28 高、15/500 --ink-3、上距 14；
 * `action` 放排序图标之类的右侧动作。
 */
export interface DrawerSectionProps {
  title: ReactNode
  action?: ReactNode
  className?: string
}

export const DrawerSection = ({ title, action, className }: DrawerSectionProps) => (
  <div className={cx(styles.sectionHead, className)}>
    <span>{title}</span>
    {action}
  </div>
)

/**
 * 会话行（mockup `.session-row`）：50 高、14 圆角、左右 16/14，间距 6；
 * 选中行 `--brand-soft` 底 + `--brand` 字，行尾可挂 24 的更多按钮。
 */
export interface SessionRowProps {
  title: ReactNode
  active?: boolean
  more?: ReactNode
  onClick?: () => void
  className?: string
}

export const SessionRow = ({
  title,
  active = false,
  more,
  onClick,
  className,
}: SessionRowProps) => {
  const classes = cx(styles.sessionRow, active ? styles.sessionActive : '', className)
  const content = (
    <>
      <span className={styles.sessionTitle}>{title}</span>
      {more ? <span className={styles.sessionMore}>{more}</span> : null}
    </>
  )
  if (!onClick) {
    return <div className={classes}>{content}</div>
  }
  return (
    <button type="button" className={classes} onClick={onClick}>
      {content}
    </button>
  )
}

/**
 * 抽屉底部账户行（mockup `.drawer-bottom`）：68 高、头像 36、名字 17/500；
 * 右侧 36 的更多按钮，颜色比正文浅一档。
 */
export interface DrawerAccountProps {
  avatar: ReactNode
  name: ReactNode
  more?: ReactNode
  className?: string
}

export const DrawerAccount = ({ avatar, name, more, className }: DrawerAccountProps) => (
  <div className={cx(styles.account, className)}>
    {avatar}
    <div className={styles.who}>
      <div className={styles.name}>{name}</div>
    </div>
    {more ?? (
      <IconButton label={translate('more')} size="md" className={styles.accountMore}>
        <MoreIcon size={18} />
      </IconButton>
    )}
  </div>
)
