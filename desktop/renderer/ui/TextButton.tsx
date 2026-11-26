import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './TextButton.module.css'
import { cx } from './cx'

/** 文字按钮：链接式操作（清屏、查看全部、改密码…），高度跟随正文。 */
export type TextButtonTone = 'accent' | 'quiet' | 'danger'

export interface TextButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: TextButtonTone
  icon?: ReactNode
}

export function TextButton({
  tone = 'accent',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: TextButtonProps) {
  return (
    <button type={type} className={cx(styles.textButton, styles[tone], className)} {...rest}>
      {icon}
      {children}
    </button>
  )
}
