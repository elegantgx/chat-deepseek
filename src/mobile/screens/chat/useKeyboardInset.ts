import { useLayoutEffect, useRef } from 'react'

/**
 * 键盘安全区：`Shell` 只留了系统手势/刘海的安全区，软键盘是另一层。
 *
 * 不用 `window.innerHeight` 猜键盘高度：Android WebView 与 iOS Safari 的布局视口行为不同。
 * 这里沿用 `src/app/viewport.ts` 的思路，读 `visualViewport`，把「布局视口底部 - 可视区域底部」
 * 的差值写到 CSS 变量，由输入区用自己的 padding 把它顶起来：
 * - Android adjustResize 时布局视口跟着缩小，差值是 0，不会重复留白；
 * - iOS 布局视口不动、可视区域变矮，差值就是键盘高度。
 *
 * 只在输入控件获得焦点时生效，失焦立刻归零，避免收起键盘的过渡期一直留一条空白。
 */
export const useKeyboardInset = () => {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const viewport = window.visualViewport
    const inputSelector = 'textarea, input:not([type="file"])'
    let frame = 0

    const reset = () => {
      root.style.removeProperty('--chat-keyboard-inset')
    }

    const update = () => {
      if (!document.activeElement?.matches(inputSelector)) {
        reset()
        return
      }
      // 双指缩放时可视区域尺寸不代表键盘，保持当前布局。
      if (viewport && viewport.scale !== 1) {
        return
      }
      const height = viewport?.height ?? window.innerHeight
      const top = viewport?.offsetTop ?? 0
      const inset = Math.max(0, Math.round(window.innerHeight - height - top))
      root.style.setProperty('--chat-keyboard-inset', `${inset}px`)
    }

    const schedule = () => {
      update()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const onFocusIn = () => {
      if (document.activeElement?.matches(inputSelector)) {
        schedule()
      }
    }

    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', schedule)
      reset()
    }
  }, [])

  return rootRef
}
