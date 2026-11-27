import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

/**
 * 屏内异步动作的卸载保护。
 *
 * `await host.request(...)` 与轮询可能跨过用户返回：没有这层判断，启动/保存完成后会
 * 在另一屏上突然跳转或弹 toast。定时器另有自己的 cleanup，这里只负责 request 之后的写入。
 */
export const useAliveRef = (): MutableRefObject<boolean> => {
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  return aliveRef
}
