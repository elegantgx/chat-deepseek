/**
 * 本机服务器组共用的两个展示辅助：短路径与监听地址的主机部分。
 *
 * 为什么不是直接展示完整路径：示意里状态卡把数据目录写成末两段（`files/data`），
 * 完整 Android 私有路径在 390 宽下必然被省略号截断，而验收要求“无省略号截断”。
 * 只截展示，不改变真实值；主机参数页同理（备份目录多留一段）。
 */
export const compactPath = (value: string, segments: number): string => {
  const parts = value.split('/').filter(Boolean)
  if (parts.length <= segments) {
    return value
  }
  return parts.slice(-segments).join('/')
}

/** `127.0.0.1:8091` → `127.0.0.1`；IPv6 的 `[::1]:8091` 也能去掉端口 */
export const listenHost = (listen: string): string => listen.replace(/:\d+$/, '')

/** 把 `{count}` 这类占位符替换成实值；模板本身留在 strings.ts，避免数字进 key */
export const formatTemplate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  )
