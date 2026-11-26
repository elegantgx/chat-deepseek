/**
 * 把 `system.status.service.listen`（契约是 `host:port`）推导成可打开的页面地址。
 *
 * 监听在 0.0.0.0 / :: / [::] / 空 host 时代表「所有网卡」，浏览器打不开这种地址，
 * 统一回落到本机回环。推导失败返回 null，界面据此禁用「打开页面」。
 */
export function servicePageUrl(listen: string | null | undefined): string | null {
  const value = listen?.trim()
  if (!value) {
    return null
  }
  // 端口一定在最后一个冒号后面；IPv6 字面量必须带方括号，和设置页的校验一致。
  const separator = value.lastIndexOf(':')
  if (separator < 0) {
    return null
  }
  const port = value.slice(separator + 1)
  if (!/^\d+$/.test(port)) {
    return null
  }
  const portNumber = Number(port)
  if (portNumber < 1 || portNumber > 65535) {
    return null
  }

  let host = value.slice(0, separator)
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }
  if (host === '' || host === '0.0.0.0' || host === '::') {
    host = '127.0.0.1'
  }
  // URL 里的 IPv6 字面量要放回方括号，否则 `http://::1:8091` 解析不了。
  const target = host.includes(':') ? `[${host}]` : host
  try {
    return new URL(`http://${target}:${portNumber}`).origin
  } catch {
    return null
  }
}
