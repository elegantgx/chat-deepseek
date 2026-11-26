/**
 * 主进程、preload、渲染层共用的 IPC 契约。
 * 只放类型，不放运行时代码：三边都能引用，且不会被打进产物。
 */

/** preload 通过 contextBridge 暴露到 window.host 的全部能力 */
export interface HostApi {
  /**
   * 向 Go 后端转发一次 JSON-RPC 2.0 请求。
   * 成功时 resolve 后端的 result；失败时 reject 一个 HostErrorPayload（不是 Error：
   * Error 跨 contextBridge 会丢自定义字段，code 就没了）。
   */
  request(method: string, params?: unknown): Promise<unknown>
  /**
   * 订阅后端主动推送的事件（方法名形如 `event.service.log`）。
   * 返回取消订阅函数，重复调用安全。
   */
  onEvent(cb: (method: string, params: unknown) => void): () => void
}

/** 渲染层拿到的失败值：先看 code 做分支，message 只用于展示 */
export interface HostErrorPayload {
  code: string
  message: string
}

/**
 * ipcMain.handle('host:request') 的返回形状。
 * 用 ok 区分成败而不是直接 throw，否则 Electron 只保留 Error.message，code 会丢。
 */
export type HostReply = { ok: true; result: unknown } | { ok: false; error: HostErrorPayload }

declare global {
  interface Window {
    /** 由 preload 注入；纯浏览器里直接打开渲染层（无 preload）时为 undefined */
    host: HostApi
  }
}
