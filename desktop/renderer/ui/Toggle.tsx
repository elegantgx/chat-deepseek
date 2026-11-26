import styles from './Toggle.module.css'
import { cx } from './cx'

export interface ToggleProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  /** 无障碍名；界面上若已有可见文案，传同一句话即可，不要留空 */
  label: string
  disabled?: boolean
  className?: string
}

export function Toggle({ checked, onChange, label, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx(styles.toggle, checked && styles.on, className)}
      onClick={() => onChange?.(!checked)}
    >
      <span className={styles.knob} aria-hidden="true" />
    </button>
  )
}
