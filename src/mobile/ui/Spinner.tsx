import { cx } from './cx.js'
import styles from './Spinner.module.css'

/**
 * 转圈（mockup `.spinner`）：16 给 48 高按钮，12 给行内小状态，24 给阻塞卡。
 * 颜色继承 currentColor，所以主按钮里自然是白圈、危险按钮里是红圈，不另写变体。
 * 截图/省电场景由 CSS 的 prefers-reduced-motion 停成静态圈，尺寸不变。
 */
export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export const Spinner = ({ size = 'md', className }: SpinnerProps) => (
  <span
    className={cx(
      styles.spinner,
      size === 'sm' ? styles.sm : '',
      size === 'lg' ? styles.lg : '',
      className
    )}
    aria-hidden="true"
  />
)
