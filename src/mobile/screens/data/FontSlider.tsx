import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import styles from './FontSize.module.css'

export const FONT_SIZE_LEVELS = 5

export interface FontSliderProps {
  /** 0–4，0 最小、4 最大 */
  value: number
  onChange: (value: number) => void
  label: string
}

const clampLevel = (value: number): number => Math.min(FONT_SIZE_LEVELS - 1, Math.max(0, value))

/**
 * 字号滑轨。
 *
 * 示意里的刻度是 0/25/50/75/100%，滑块中心正好落在刻度上；原生 range 会把
 * 26px 滑块的内缩算进去，25% 的位置会偏 6.5px。所以用普通 div + pointer 事件，
 * 位置和示意图完全一致，同时保留 role="slider" 的键盘操作。
 */
export const FontSlider = ({ value, onChange, label }: FontSliderProps) => {
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const updateFromClientX = (clientX: number) => {
    const element = track.current
    if (!element) {
      return
    }
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0) {
      return
    }
    const ratio = (clientX - rect.left) / rect.width
    onChange(clampLevel(Math.round(ratio * (FONT_SIZE_LEVELS - 1))))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragging.current = true
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 合成事件（自动化/预览脚本）没有活动指针时 setPointerCapture 会抛错，拖动仍要继续
    }
    updateFromClientX(event.clientX)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) {
      updateFromClientX(event.clientX)
    }
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next = clampLevel(value - 1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next = clampLevel(value + 1)
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = FONT_SIZE_LEVELS - 1
    }
    if (next !== null) {
      event.preventDefault()
      onChange(next)
    }
  }

  const position = `${(value / (FONT_SIZE_LEVELS - 1)) * 100}%`

  return (
    <div
      ref={track}
      className={styles.range}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={FONT_SIZE_LEVELS - 1}
      aria-valuenow={value}
      style={{ '--pos': position } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {[0, 25, 50, 75, 100].map((tick) => (
        <span key={tick} className={styles.tick} style={{ left: `${tick}%` }} />
      ))}
      <span className={styles.thumb} />
    </div>
  )
}
