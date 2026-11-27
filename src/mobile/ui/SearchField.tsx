import type { InputHTMLAttributes } from 'react'
import { cx } from './cx.js'
import { SearchIcon } from './icons.js'
import styles from './SearchField.module.css'

/**
 * 抽屉里的搜索胶囊（mockup `.drawer-search`）：52 高、26 圆角、`--fill-2` 底，
 * 左 16 右 18，图标 22 与文字间距 10，字号 17。
 * 组件本身不带外边距，抽屉里由 DrawerSearch 负责定位。
 */
export interface SearchFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'className' | 'type'
> {
  className?: string
}

export const SearchField = ({ className, ...rest }: SearchFieldProps) => (
  <label className={cx(styles.root, className)}>
    <SearchIcon className={styles.icon} size={22} />
    <input type="search" className={styles.input} {...rest} />
  </label>
)
