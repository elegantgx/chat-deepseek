import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import styles from './Dialog.module.css'
import { cx } from './cx'

export interface DialogProps {
  open: boolean
  title: string
  description?: ReactNode
  children?: ReactNode
  /** 右下角操作区，通常放 Button */
  actions?: ReactNode
  onClose?: () => void
  size?: 'md' | 'sm'
  /**
   * overlay：产品里的模态浮层（fixed + 遮罩）；
   * contained：只铺满最近的定位父级，供组件总览把浮层放进样例框。
   */
  variant?: 'overlay' | 'contained'
  className?: string
}

/** Tab 只在对话框内部循环：模态窗口不能让背景抢走焦点 */
const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Dialog({
  open,
  title,
  description,
  children,
  actions,
  onClose,
  size = 'md',
  variant = 'overlay',
  className,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    // Esc 关闭；onClose 不传时视为不可关闭（例如必须做出选择）
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!onClose) {
          return
        }
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || variant !== 'overlay') {
        return
      }
      const node = dialogRef.current
      if (!node) {
        return
      }
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        // 没有可聚焦元素时把 Tab 吃掉，避免焦点跑到背景
        event.preventDefault()
        node.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !node.contains(active)
      if (event.shiftKey && (outside || active === first)) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, variant])

  useEffect(() => {
    // contained 只是总览页的样例，不能抢页面焦点
    if (!open || variant !== 'overlay') {
      return
    }
    const previous = document.activeElement as HTMLElement | null
    const node = dialogRef.current
    const target = node?.querySelector<HTMLElement>(FOCUSABLE) ?? node
    target?.focus()
    return () => {
      // 关掉以后焦点回到触发它的按钮，读屏用户不会掉到文档开头
      previous?.focus()
    }
  }, [open, variant])

  if (!open) {
    return null
  }

  return (
    <div className={cx(styles.overlay, variant === 'contained' && styles.contained)}>
      <div className={styles.scrim} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={variant === 'overlay' ? true : undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx(styles.dialog, size === 'sm' && styles.small, className)}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        ) : null}
        {children}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  )
}
