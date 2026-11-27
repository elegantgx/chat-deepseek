import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Radio.module.css'

/**
 * 单选圆点（mockup `.radio`）：22 圆，未选描边 1.5 `--ring`，选中描边 2 `--brand` + 内点 10。
 * 圆点和描边都用整数像素，半像素取整后不会偏向一侧。
 */
export interface RadioProps {
  checked: boolean
  className?: string
}

export const Radio = ({ checked, className }: RadioProps) => (
  <span className={cx(styles.radio, checked ? styles.on : '', className)} aria-hidden="true">
    {checked ? <span className={styles.dot} /> : null}
  </span>
)

/**
 * 单选弹窗里的选项行（mockup `.modal-option`）：56 高、左 22、间距 14、17px。
 * 角色选择这类“整行可点 + 右侧圆点”用 ListRow + Radio 组合，不必套这一层。
 */
export interface RadioRowProps {
  checked: boolean
  children: ReactNode
  onSelect: () => void
  disabled?: boolean
  className?: string
}

export const RadioRow = ({
  checked,
  children,
  onSelect,
  disabled = false,
  className,
}: RadioRowProps) => (
  <button
    type="button"
    role="radio"
    aria-checked={checked}
    disabled={disabled}
    className={cx(styles.option, className)}
    onClick={onSelect}
  >
    <Radio checked={checked} />
    <span className={styles.label}>{children}</span>
  </button>
)
