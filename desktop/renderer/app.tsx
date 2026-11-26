import { useEffect, useState } from 'react'
import type { HostApi, HostErrorPayload } from '../ipc'

/**
 * 占位壳：只证明「React 挂载 + preload 注入 + 请求/事件通道」能走通。
 * 真正的页面与视觉由后续的页面 agent 替换，这里不要堆样式和业务。
 */

/** 四个空导航项，留给页面 agent 接真实路由（文案对齐产品：服务/账户/备份/设置） */
const NAV_ITEMS = ['服务', '账户', '备份', '设置']

type HostStatus = { ok: boolean; detail: string }

export function App() {
  const [status, setStatus] = useState<HostStatus>({ ok: true, detail: '正在请求 system.status…' })

  useEffect(() => {
    // 纯浏览器里直接打开渲染层时没有 preload，这里必须容忍 undefined
    const host: HostApi | undefined = window.host
    if (!host) {
      setStatus({ ok: false, detail: '未检测到 preload（当前不是 Electron 环境）' })
      return
    }

    let cancelled = false
    host.request('system.status').then(
      (result) => {
        if (!cancelled) {
          setStatus({ ok: true, detail: JSON.stringify(result) })
        }
      },
      (error: unknown) => {
        if (cancelled) {
          return
        }
        // 失败值是 {code, message}（不是 Error），见 ipc.d.ts
        const { code, message } = error as Partial<HostErrorPayload>
        setStatus({ ok: false, detail: `${code ?? 'unknown'}: ${message ?? '请求失败'}` })
      }
    )

    // 订阅后端事件（event.*），骨架阶段只打日志，证明通道可用
    const off = host.onEvent((method, params) => {
      // oxlint-disable-next-line no-console -- 骨架阶段只把事件打到控制台，页面 agent 会接手
      console.log('[host event]', method, params)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  return (
    <main>
      <h1>chat-deepseek 桌面端</h1>
      <p>工程骨架：页面与视觉尚未实现。</p>
      <p role="status">{`后端：${status.ok ? status.detail : `不可用（${status.detail}）`}`}</p>
      <nav aria-label="主导航">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item}>
              <span aria-disabled="true">{item}</span>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  )
}
