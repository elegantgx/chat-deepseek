import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'
import { cx } from './cx'

/** 主 / 次 / 危险 / 危险实心；禁用是状态，不用单独的 tone 表达。 */
export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'dangerSolid'
export type ButtonSize = 'md' | 'sm'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone
  size?: ButtonSize
  /** 按钮内左侧图标（15px 内联 SVG） */
  icon?: ReactNode
}

export function Button({
  tone = 'primary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[tone], size === 'sm' && styles.small, className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
