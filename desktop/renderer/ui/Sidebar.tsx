import type { ReactNode } from 'react'
import styles from './Sidebar.module.css'
import { cx } from './cx'

/** 常驻玻璃层：品牌 / 导航 / 底部状态，内容全部由调用方传入。 */
export interface SidebarProps {
  brand: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** 导航区的无障碍名 */
  navLabel?: string
  className?: string
}

export function Sidebar({ brand, children, footer, navLabel = '主导航', className }: SidebarProps) {
  return (
    <aside className={cx(styles.sidebar, className)}>
      {brand}
      <nav className={styles.nav} aria-label={navLabel}>
        {children}
      </nav>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </aside>
  )
}

export interface SidebarBrandProps {
  name: string
  subtitle?: string
  icon?: ReactNode
  className?: string
}

export function SidebarBrand({ name, subtitle, icon, className }: SidebarBrandProps) {
  return (
    <div className={cx(styles.brand, className)}>
      {icon ? (
        <span className={styles.brandMark} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>
        <span className={styles.brandName}>{name}</span>
        {subtitle ? <span className={styles.brandSub}>{subtitle}</span> : null}
      </span>
    </div>
  )
}

export interface SidebarItemProps {
  icon: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
}

export function SidebarItem({
  icon,
  label,
  active = false,
  disabled,
  onClick,
  className,
}: SidebarItemProps) {
  return (
    <button
      type="button"
      className={cx(styles.item, active && styles.active, className)}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
