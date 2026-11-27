import type { ReactNode } from 'react'
import { cx } from './cx.js'
import { UserCompactIcon } from './icons.js'
import styles from './Avatar.module.css'

/**
 * 头像（mockup `.avatar` 36 / `.avatar-lg` 72 + 角标）。
 * 抽屉底部账户是 36 的弱底头像；账号管理是 72 的品牌色头像，右下角可挂编辑角标。
 * 有名字时取首字，没人名就退回用户图标，避免出现空白圆。
 */
export interface AvatarProps {
  size?: 'sm' | 'lg'
  /** 显示名；取第一个字符当头像字 */
  name?: string
  icon?: ReactNode
  /** 右下角角标（36 的不显示，与示意一致） */
  badge?: ReactNode
  className?: string
}

export const Avatar = ({ size = 'sm', name, icon, badge, className }: AvatarProps) => {
  const initial = name ? Array.from(name)[0] : null
  return (
    <span className={cx(styles.avatar, size === 'lg' ? styles.lg : '', className)}>
      {icon ?? initial ?? <UserCompactIcon size={20} />}
      {size === 'lg' && badge ? <span className={styles.badge}>{badge}</span> : null}
    </span>
  )
}
