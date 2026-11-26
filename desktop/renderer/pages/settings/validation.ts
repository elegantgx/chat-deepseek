/** 设置页的字段校验：只做格式检查，真实冲突与权限由后端返回。 */

const WHITESPACE = /\s/

function validatePort(text: string): string | undefined {
  if (!/^\d+$/.test(text)) {
    return '端口需为 1–65535 的整数'
  }
  const port = Number(text)
  if (port < 1 || port > 65535) {
    return '端口需为 1–65535 的整数'
  }
  return undefined
}

/**
 * 监听地址必须是 host:port。
 * 支持 IPv4 / 主机名 / 用方括号包裹的 IPv6；不接受带协议前缀的 URL。
 */
export function validateListen(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return '请输入监听地址，例如 127.0.0.1:8091'
  }
  if (WHITESPACE.test(trimmed)) {
    return '监听地址不能包含空格'
  }

  if (trimmed.startsWith('[')) {
    const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(trimmed)
    if (!bracketed) {
      return 'IPv6 地址需写成 [地址]:端口，例如 [::1]:8091'
    }
    return validatePort(bracketed[2])
  }

  const separator = trimmed.lastIndexOf(':')
  if (separator <= 0) {
    return '监听地址需为 host:port，例如 127.0.0.1:8091'
  }

  const host = trimmed.slice(0, separator)
  const port = trimmed.slice(separator + 1)
  if (host.includes(':')) {
    return 'IPv6 地址需用方括号包裹，例如 [::1]:8091'
  }
  if (host.includes('/') || host.includes('?')) {
    return '监听地址只写 host:port，不要带路径或协议'
  }
  return validatePort(port)
}

/** API 地址必须是 http(s) URL；允许带路径，例如反向代理的 /v1 前缀。 */
export function validateApiOrigin(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return '请输入 API 地址'
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'API 地址需为 http(s) URL，例如 https://api.deepseek.com'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'API 地址需以 http:// 或 https:// 开头'
  }
  if (!url.hostname) {
    return 'API 地址需包含主机名'
  }
  return undefined
}

/**
 * 备份目录按契约必须是绝对路径；空字符串合法，表示清除配置、回落到默认目录。
 * 接受 POSIX 的 `/...` 与 Windows 的 `C:\...` / `C:/...`；拒绝 `~/` 和相对路径。
 */
export function validateBackupDir(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(trimmed)) {
    return '备份目录需要绝对路径，留空使用默认目录'
  }
  return undefined
}
