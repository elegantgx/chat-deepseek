import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { COMPARE_HTML } from './compare-page.mjs'

/**
 * 一个进程内同时托管三份内容：
 * - `/mockups/**` → `docs/android/mockups/`（示意）
 * - `/app/**`     → `dist-mobile/`（实现，可被 --app-dir 覆盖）
 * - `/__shots/**` → `tmp/shots/`（截图、对比图、report.json，只给本机看）
 *
 * 三条路径同源，canvas 读图不会被跨源污染；全部 `no-store`，避免 Chrome
 * 在同一进程里复用旧页面时拿到上一次的图。
 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
}

const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
}

const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body)
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': data.length,
    ...NO_CACHE,
  })
  res.end(data)
}

/** 把请求路径安全地落到 root 下；任何试图跳出 root 的路径都拒绝 */
const resolveInside = (root, relative) => {
  const target = path.resolve(root, `.${path.sep}${relative}`)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return null
  }
  return target
}

export const startStaticServer = async ({ mockupDir, appDir, shotsDir }) => {
  const roots = [
    ['/mockups', path.resolve(mockupDir)],
    ['/app', path.resolve(appDir)],
    ['/__shots', path.resolve(shotsDir)],
  ]

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'method not allowed')
        return
      }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204, NO_CACHE)
        res.end()
        return
      }
      if (url.pathname === '/__shots/compare') {
        send(res, 200, COMPARE_HTML, MIME['.html'])
        return
      }
      if (url.pathname === '/') {
        send(res, 200, 'shots static server\n/mockups/ · /app/ · /__shots/\n')
        return
      }

      const match = roots.find(
        ([prefix]) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
      )
      if (!match) {
        send(res, 404, `not found: ${url.pathname}`)
        return
      }
      const [prefix, root] = match
      let relative
      try {
        relative = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\/+/, '')
      } catch {
        send(res, 400, 'bad url encoding')
        return
      }
      const file = resolveInside(root, relative || 'index.html')
      if (!file) {
        send(res, 403, 'forbidden')
        return
      }

      const stat = await fs.stat(file).catch(() => null)
      if (!stat?.isFile()) {
        send(res, 404, `not found: ${url.pathname}`)
        return
      }
      const data = await fs.readFile(file)
      res.writeHead(200, {
        'Content-Type': mimeFor(file),
        'Content-Length': data.length,
        ...NO_CACHE,
      })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch (error) {
      send(res, 500, `server error: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('静态服务没有拿到端口')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        // keep-alive 连接会拖住 close；截图进程退出前直接断开即可。
        server.closeAllConnections?.()
      }),
  }
}
