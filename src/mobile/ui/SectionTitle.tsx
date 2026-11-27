import { cx } from './cx.js'
import styles from './SectionTitle.module.css'

/**
 * 分组标签。设置类页面用 mockup `.settings-label`（14/20、左缩进 17）；
 * `compact` 对应早期原语 `.group-label`（13/18、左缩进 4），留给非卡片场景。
 */
export interface SectionTitleProps {
  children: string
  variant?: 'page' | 'compact'
  className?: string
}

export const SectionTitle = ({ children, variant = 'page', className }: SectionTitleProps) => (
  <h2 className={cx(styles.title, variant === 'compact' ? styles.compact : '', className)}>
    {children}
  </h2>
)
