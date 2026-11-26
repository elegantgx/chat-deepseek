import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import styles from './Segmented.module.css'
import { cx } from './cx'

export interface SegmentedOption<Value extends string> {
  value: Value
  label: string
  disabled?: boolean
}

export interface SegmentedProps<Value extends string> {
  options: ReadonlyArray<SegmentedOption<Value>>
  value: Value
  onChange?: (value: Value) => void
  /** radiogroup 的无障碍名 */
  label: string
  /** 视觉稿里 260 / 148 / 204 三种宽度；不传走 260 */
  width?: number
  className?: string
}

export function Segmented<Value extends string>({
  options,
  value,
  onChange,
  label,
  width,
  className,
}: SegmentedProps<Value>) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  // radiogroup 的键盘约定：左右箭头在可用项间循环，并同步焦点
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    const enabled = options.filter((option) => !option.disabled)
    if (enabled.length === 0) {
      return
    }
    const current = enabled.findIndex((option) => option.value === value)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = enabled[(current + step + enabled.length) % enabled.length]
    event.preventDefault()
    onChange?.(next.value)
    const nextIndex = options.indexOf(next)
    itemRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(styles.seg, className)}
      style={width === undefined ? undefined : { width }}
      onKeyDown={handleKeyDown}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            className={cx(
              styles.item,
              selected && styles.selected,
              option.disabled && styles.disabled
            )}
            onClick={() => onChange?.(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
