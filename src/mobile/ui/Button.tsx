import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx.js'
import { Spinner } from './Spinner.js'
import styles from './Button.module.css'

/**
 * 外壳级按钮（mockup `.btn` 及各变体）。尺寸全部取自示意：
 * 基础 44 高 / 圆角 12 / 15px，主按钮 48 高 / 600 字重，页面主操作 52，
 * 全宽 `btn-block` 是 999 胶囊。禁用主按钮保留品牌色只降 45%，
 * 其余变体禁用统一退成 `--fill` + `--ink-3`（示意 `.btn.is-disabled`），
 * 这样“不可用”不会看成一个空白块。
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'quiet'
  | 'text'
  | 'textDanger'
export type ButtonSize = 'md' | 'page' | 'sm' | 'xs' | 'card' | 'inline'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  /** 进行中：保留按钮自己的颜色，内容前加转圈，并禁掉再点（示意 `.btn.is-loading`） */
  loading?: boolean
  children: ReactNode
}

const variantClass = (variant: ButtonVariant): string => {
  switch (variant) {
    case 'secondary':
      return styles.secondary
    case 'ghost':
      return styles.ghost
    case 'danger':
      return styles.danger
    case 'quiet':
      return styles.quiet
    case 'text':
      return styles.text
    case 'textDanger':
      return styles.textDanger
    default:
      return styles.primary
  }
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    className={cx(
      styles.button,
      variantClass(variant),
      styles[size],
      block ? styles.block : '',
      loading ? styles.loading : '',
      className
    )}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...rest}
  >
    {loading ? <Spinner /> : null}
    {children}
  </button>
)
