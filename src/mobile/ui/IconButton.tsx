import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './IconButton.module.css'

/**
 * 单图标按钮：44 的聊天顶栏动作、36 的抽屉账户更多、34 的顶栏返回与输入区工具。
 * 命中区跟着示意走（34 就是 34，不再套 44 热区），因为这一层的视觉密度已经按 34 定过。
 * `label` 必填：图标对读屏没有语义。
 */
export type IconButtonVariant = 'plain' | 'chip' | 'brand'
export type IconButtonSize = 'sm' | 'md' | 'lg'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
  variant?: IconButtonVariant
  size?: IconButtonSize
  children: ReactNode
}

export const IconButton = ({
  label,
  variant = 'plain',
  size = 'sm',
  className,
  type = 'button',
  children,
  ...rest
}: IconButtonProps) => (
  <button
    type={type}
    aria-label={label}
    className={cx(
      styles.button,
      variant === 'chip' ? styles.chip : '',
      variant === 'brand' ? styles.brand : '',
      styles[size],
      className
    )}
    {...rest}
  >
    {children}
  </button>
)
