import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './toast.module.css'

/**
 * 外壳级 toast：屏里的写操作失败/成功统一走这里，避免每屏自己造一层浮层。
 * 文案由调用方传入（必须已经过 i18n），这里不读业务文案。
 */
interface ToastContextValue {
  showToast(message: string): void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_DURATION_MS = 2200

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sequenceRef = useRef(0)

  const showToast = useCallback((message: string) => {
    sequenceRef.current += 1
    setToast({ id: sequenceRef.current, message })
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setToast(null)
    }, TOAST_DURATION_MS)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    },
    []
  )

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </ToastContext.Provider>
  )
}

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast 必须在 ToastProvider 内使用')
  }
  return context
}
