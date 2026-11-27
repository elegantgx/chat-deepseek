import { cx } from './cx.js'
import styles from './Switch.module.css'

/**
 * 开关（mockup `.switch`）：51 × 31，轨道关 `--line` / 开 `--green`，
 * 圆点 27 白、上 2，关左 2 / 开左 22；阴影比轨道深一点，让圆点在白卡上立起来。
 */
export interface SwitchProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  /** 读屏名称；视觉上开关只表现为一条轨道 */
  label: string
  disabled?: boolean
  className?: string
}

export const Switch = ({ checked, onChange, label, disabled = false, className }: SwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={cx(styles.track, checked ? styles.on : '', className)}
    onClick={() => onChange?.(!checked)}
  >
    <span className={styles.knob} />
  </button>
)
