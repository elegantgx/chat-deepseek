import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HostApi, HostReply } from './ipc'

/** 与 main.ts 里的通道名保持一致 */
const REQUEST_CHANNEL = 'host:request'
const EVENT_CHANNEL = 'host:event'

/**
 * 只暴露这两个方法：渲染层拿不到 ipcRenderer 本身，也拿不到 Node。
 * 类型取自 ipc.d.ts，实现若与契约漂移会在这里报错。
 */
const host: HostApi = {
  async request(method: string, params?: unknown): Promise<unknown> {
    const reply = (await ipcRenderer.invoke(REQUEST_CHANNEL, method, params)) as HostReply
    if (reply.ok) {
      return reply.result
    }
    // Error 跨 contextBridge 会被重建，自定义字段（code）会丢；按契约直接 reject 纯对象
    throw { code: reply.error.code, message: reply.error.message }
  },
  onEvent(cb: (method: string, params: unknown) => void): () => void {
    const listener = (_event: IpcRendererEvent, method: string, params: unknown): void => {
      cb(method, params)
    }
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => {
      ipcRenderer.off(EVENT_CHANNEL, listener)
    }
  },
}

contextBridge.exposeInMainWorld('host', host)
