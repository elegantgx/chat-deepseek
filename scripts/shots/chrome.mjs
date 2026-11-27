import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Chrome 生命周期 + 一个够用就好的 CDP 客户端。
 *
 * 不锁 Chrome 版本：同一进程里先截示意、再截实现，字体/光栅化的版本漂移
 * 对两张图是同一份，天然抵消（见 docs/android-architecture.md §9）。
 * 因此这里只依赖 `--remote-debugging-port` 的稳定部分：`/json/version`、
 * `PUT /json/new`、Page/Runtime/Network/Emulation 四个域。
 */

const CHROME_CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
]

const CHROME_FLAGS = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
]

/** 拿一个当前空闲的回环端口；关闭监听与 Chrome 抢占之间有极小窗口，抢到就换 */
export const findFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('没有拿到空闲端口'))
        return
      }
      server.close(() => resolve(address.port))
    })
  })

const fetchJson = async (url, init) => {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${url} 返回 ${response.status}`)
  }
  return response.json()
}

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (event) => this.onMessage(event.data))
    ws.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer)
        reject(new Error('CDP 连接已关闭'))
      }
      this.pending.clear()
    })
  }

  static async connect(url) {
    if (typeof WebSocket === 'undefined') {
      throw new Error('当前 Node 没有全局 WebSocket，请用 Node 22.12+')
    }
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`CDP 连接失败: ${url}`)), { once: true })
    })
    return new CdpClient(ws)
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? []
    list.push(listener)
    this.listeners.set(method, list)
    return () => {
      this.listeners.set(
        method,
        (this.listeners.get(method) ?? []).filter((item) => item !== listener)
      )
    }
  }

  /** 等下一次事件；页面导航用 Page.loadEventFired 判断“新文档真的来了” */
  once(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let timer
      const off = this.on(method, (params) => {
        clearTimeout(timer)
        off()
        resolve(params)
      })
      timer = setTimeout(() => {
        off()
        reject(new Error(`等待 CDP 事件超时（${timeoutMs}ms）: ${method}`))
      }, timeoutMs)
      timer.unref?.()
    })
  }

  onMessage(raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (message.id) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) {
        entry.reject(new Error(`${entry.method}: ${message.error.message}`))
      } else {
        entry.resolve(message.result)
      }
      return
    }
    if (!message.method) return
    for (const listener of this.listeners.get(message.method) ?? []) {
      try {
        listener(message.params)
      } catch {
        // 事件监听不能反过来打断截图主流程
      }
    }
  }

  send(method, params = {}, timeoutMs = 120000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP 超时（${timeoutMs}ms）: ${method}`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // 已经断了就无所谓
    }
  }
}

/** 启动 Chrome 并等到调试端口可用；返回后调用方负责 kill + 删 profile */
export const launchChrome = async ({ chromePath, port, profileDir, verbose = false }) => {
  const args = [
    ...CHROME_FLAGS,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=390,844',
  ]
  // CI 容器常以 root 跑；Chromium 的 setuid sandbox 在 root 下会直接拒绝启动。
  // 只在 root 下关闭，普通开发机仍然保留 sandbox。
  if (process.getuid?.() === 0) {
    args.push('--no-sandbox', '--disable-setuid-sandbox')
  }
  args.push('about:blank')
  if (verbose) {
    console.log(`[chrome] ${chromePath} ${args.join(' ')}`)
  }
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8000)
  })

  let exited = false
  child.once('exit', () => {
    exited = true
  })

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`Chrome 启动即退出（${chromePath}）:\n${stderr}`)
    }
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`)
      return {
        child,
        version: version.Browser,
        stderr: () => stderr,
        stop: async () => {
          if (!exited) {
            child.kill('SIGTERM')
            const killDeadline = Date.now() + 3000
            while (!exited && Date.now() < killDeadline) {
              await sleep(80)
            }
            if (!exited) child.kill('SIGKILL')
          }
          await new Promise((resolve) => {
            if (exited) {
              resolve()
            } else {
              child.once('exit', resolve)
              setTimeout(resolve, 2000).unref?.()
            }
          })
        },
      }
    } catch {
      await sleep(120)
    }
  }
  child.kill('SIGKILL')
  throw new Error(`Chrome 20s 内没起来（${chromePath}）:\n${stderr}`)
}

/** 新建一个 page target 并连它的 page WebSocket；headless 下比操作已有 tab 稳 */
export const connectPage = async ({ port, verbose = false }) => {
  let target = null
  try {
    target = await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  } catch {
    // 老版本 Chrome 的 /json/new 只接受 GET，再退一步拿现有 tab。
    try {
      target = await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`)
    } catch {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? null
    }
  }
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('Chrome 没有返回可用的 page target')
  }
  if (verbose) {
    console.log(`[cdp] page target ${target.id ?? '(unknown)'}`)
  }
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  return cdp
}

/** 390 × 844、@2x、mobile。截图会得到 780 × 1688。 */
export const setViewport = async (cdp, { width, height, deviceScaleFactor, mobile }) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile,
    screenWidth: width,
    screenHeight: height,
  })
}

/** 明暗与 reduced-motion 都用 Emulation 模拟；不能用 --force-dark-mode 代替 */
export const setMedia = async (cdp, scheme) => {
  await cdp.send('Emulation.setEmulatedMedia', {
    media: '',
    features: [
      { name: 'prefers-color-scheme', value: scheme },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  })
}

/**
 * 模拟 WebView 的系统安全区。真机上状态栏由系统画在 WebView 之外，页面只拿到
 * `env(safe-area-inset-top)`；headless 默认是 0，所以实现页会比示意页高 28px。
 * 该 CDP 命令是实验性的，老版本 Chrome 可能没有；调用方收到 ok:false 后退回
 * “照常截图 + 报告里记 unsupported”，不自己发明第三套几何。
 */
export const setSafeAreaInsets = async (cdp, insets) => {
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const evaluate = async (cdp, expression, { awaitPromise = false } = {}) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? '未知异常'
    throw new Error(`页面脚本异常: ${description}`)
  }
  return result.result.value
}

export const waitFor = async (fn, { timeoutMs = 10000, intervalMs = 80, label = '条件' } = {}) => {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      // 导航过程中 evaluate 会短暂报 execution context destroyed，重试即可
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw new Error(`等待${label}超时（${timeoutMs}ms）${lastError ? `: ${lastError.message}` : ''}`)
}

/** 打开页面并等到 readyState/fonts + 调用方给的“已挂载”条件 */
export const preparePage = async (cdp, { url, scheme, readyExpression, verbose = false }) => {
  await setMedia(cdp, scheme)
  // 先挂 load 事件再导航：同一 URL 连续打开两次时，location.href 判断会误命中旧文档。
  const loaded = cdp.once('Page.loadEventFired', 15000)
  const navigation = await cdp.send('Page.navigate', { url })
  if (navigation.errorText) {
    loaded.catch(() => {})
    throw new Error(`页面打开失败（${url}）: ${navigation.errorText}`)
  }
  await loaded
  await waitFor(
    async () => (await evaluate(cdp, 'document.readyState')) === 'complete',
    { label: 'document.readyState=complete' }
  )
  await waitFor(
    async () => evaluate(cdp, 'document.fonts.ready.then(() => true)', { awaitPromise: true }),
    { label: 'document.fonts.ready' }
  )
  if (readyExpression) {
    await waitFor(async () => evaluate(cdp, readyExpression), { label: '页面挂载' })
  }
  if (verbose) {
    console.log(`[page] ${url}`)
  }
}

export const readPageState = async (cdp) =>
  evaluate(
    cdp,
    `(() => {
      const root = document.getElementById('root')
      const body = document.body
      return {
        ready: document.readyState,
        rootChildren: root ? root.childElementCount : -1,
        hasPhone: Boolean(document.querySelector('.phone')),
        text: body ? body.innerText.slice(0, 4000) : '',
      }
    })()`
  )

/** 从 PNG 的 IHDR 读尺寸；同时充当“这确实是 PNG”的校验 */
export const pngSize = (buffer) => {
  const signature = '89504e470d0a1a0a'
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== signature) {
    throw new Error('截图不是合法的 PNG')
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * 连拍两次直到字节一致，最多 attempts 次。
 * 动画靠 reduced-motion 冻结；剩余抖动（字体/异步数据）靠这一轮兜底。
 */
export const captureStable = async (cdp, { firstDelayMs = 0, gapMs = 350, attempts = 3 } = {}) => {
  let previous = null
  let last = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt === 1) {
      if (firstDelayMs > 0) await sleep(firstDelayMs)
    } else {
      await sleep(gapMs)
    }
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    const buffer = Buffer.from(shot.data, 'base64')
    const size = pngSize(buffer)
    if (previous && buffer.equals(previous)) {
      return { buffer, size, stable: true, attempts: attempt }
    }
    previous = buffer
    last = { buffer, size }
  }
  return { ...last, stable: false, attempts }
}

/** 依次试 PATH 上的常见 Chrome 名字，返回第一个能跑 --version 的 */
export const detectChrome = () => {
  for (const candidate of CHROME_CANDIDATES) {
    const result = spawnSyncVersion(candidate)
    if (result) return { path: candidate, version: result }
  }
  return null
}

const spawnSyncVersion = (command) => {
  // 只探测 --version，不启动浏览器；用 spawnSync 避免异步污染探测顺序
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return null
  return (result.stdout || result.stderr).trim()
}
