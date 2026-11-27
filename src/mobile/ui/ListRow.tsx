import type { ReactNode } from 'react'
import { cx } from './cx.js'
import { ChevronRightIcon } from './icons.js'
import styles from './ListRow.module.css'

/**
 * 设置类页面的行（mockup `.settings-row`）：单行 52、带副标题 64，内边距 0 17，间距 14。
 * 箭头只在“能进下一层”时画；直接触发动作/弹窗不画（visual §4）。
 * 危险行只把标题与图标变红，副标题保持灰；条件不满足的行整行降级并写清原因。
 */
export interface ListRowProps {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** 右侧值；版本、路径、时间用 valueMono */
  value?: ReactNode
  valueMono?: boolean
  /** 右侧自定义内容（单选圆点、连接状态、转圈）；与 value/箭头互斥使用 */
  right?: ReactNode
  showChevron?: boolean
  danger?: boolean
  /** 仅视觉降级（示意 `.settings-row.is-muted`）：文字/图标/值变 --ink-4 */
  muted?: boolean
  /** 不可用：样式同 muted，并禁掉点击 */
  disabled?: boolean
  onClick?: () => void
  className?: string
}

export const ListRow = ({
  icon,
  title,
  subtitle,
  value,
  valueMono = false,
  right,
  showChevron = false,
  danger = false,
  muted = false,
  disabled = false,
  onClick,
  className,
}: ListRowProps) => {
  const content = (
    <>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.main}>
        <span className={styles.title}>{title}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {right}
      {value !== undefined ? (
        <span className={cx(styles.value, valueMono ? styles.valueMono : '')}>{value}</span>
      ) : null}
      {showChevron ? <ChevronRightIcon className={styles.chevron} /> : null}
    </>
  )
  const classes = cx(
    styles.row,
    subtitle ? styles.double : '',
    danger ? styles.danger : '',
    muted || disabled ? styles.muted : '',
    className
  )

  if (!onClick) {
    return (
      <div className={classes} aria-disabled={disabled || undefined}>
        {content}
      </div>
    )
  }
  return (
    <button type="button" className={classes} onClick={onClick} disabled={disabled}>
      {content}
    </button>
  )
}
