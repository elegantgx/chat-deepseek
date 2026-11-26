import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, Menu, app, ipcMain, nativeTheme } from 'electron'
import type { HostErrorPayload, HostReply } from './ipc'

// 主进程的 console 就是排障通道（stderr 转发、后端退出、冒烟标记都靠它）
/* oxlint-disable no-console */

// 窗口装饰是刻意取舍（2026-11，Electron 45 / Chromium 156），实机结论：
// - 原生 Wayland 下装饰由 Chromium 自绘，是灰底方角，用户不认可；
// - 退回 XWayland 后由 mutter 画 Adwaita 装饰（白底圆角、标题居中），无模糊感。
// 所以 Linux Wayland 会话默认走 XWayland；代价是分数缩放（如 125%）下 XWayland 可能发糊，
// 可用 CHAT_DEEPSEEK_OZONE=wayland 做对照。仅当用户显式设置该变量时才覆盖默认选择，
// X11 会话不受影响（保持 Electron 自己的平台判断）。
// 细节、诊断命令和 A/B 方法见 desktop/README.md「标题栏与 Wayland」。
if (
  process.platform === 'linux' &&
  process.env.WAYLAND_DISPLAY &&
  !process.env.CHAT_DEEPSEEK_OZONE
) {
  app.commandLine.appendSwitch('ozone-platform', 'x11')
} else if (process.env.CHAT_DEEPSEEK_OZONE) {
  app.commandLine.appendSwitch('ozone-platform', process.env.CHAT_DEEPSEEK_OZONE)
}

/** 单条请求的兜底超时；Go 侧卡住时渲染层不能永久 pending */
const REQUEST_TIMEOUT_MS = 10_000
/** 没打包即视为开发模式（Electron 里 app.isPackaged 比 NODE_ENV 可信） */
const isDev = !app.isPackaged
/** 冒烟模式：窗口从不显示，只验证两条链路后自退 */
const smoke = process.argv.includes('--smoke') || process.env.CHAT_DEEPSEEK_SMOKE === '1'
/** 与原生主题保持一致的窗口底色，避免加载期白闪 */
const DARK_BACKGROUND = '#1f1f1f'
const LIGHT_BACKGROUND = '#ffffff'
/** 渲染层能用的 IPC 通道名，preload 里必须一致 */
const REQUEST_CHANNEL = 'host:request'
const EVENT_CHANNEL = 'host:event'

/**
 * 冒烟模式用一次性 userData：
 * - 不污染真实的配置目录；
 * - 单实例锁文件就在 userData 里，因此冒烟不会和用户正在跑的实例互相干扰。
 */
let smokeUserData: string | null = null
if (smoke) {
  smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-deepseek-smoke-'))
  app.setPath('userData', smokeUserData)
}

/** 删掉冒烟用的临时 userData；Chromium 可能还占着文件，失败只记日志，不阻塞退出 */
function cleanupSmokeUserData(): void {
  if (!smokeUserData) {
    return
  }
  const dir = smokeUserData
  smokeUserData = null
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch (error) {
    console.error(`[smoke] 临时 userData 清理失败 ${dir}：${String(error)}`)
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: HostErrorPayload) => void
  timer: NodeJS.Timeout
}

/** 只声明用得到的字段；协议其余部分不解析，透传给渲染层 */
type RpcMessage = {
  id?: unknown
  method?: unknown
  params?: unknown
  result?: unknown
  error?: unknown
}

/** 把任意 reject 值收敛成带 code 的失败载荷 */
function toHostError(value: unknown): HostErrorPayload {
  if (typeof value === 'object' && value !== null) {
    const record = value as { code?: unknown; message?: unknown }
    const hasCode = typeof record.code === 'string' || typeof record.code === 'number'
    const code = hasCode ? String(record.code) : 'backend_error'
    const message = typeof record.message === 'string' ? record.message : '后端返回了未说明的错误'
    return { code, message }
  }
  if (typeof value === 'string' && value !== '') {
    return { code: 'backend_error', message: value }
  }
  return { code: 'backend_error', message: '后端返回了未说明的错误' }
}

/**
 * 与 Go 后端的 NDJSON / JSON-RPC 2.0 通道。
 * 桌面端不实现业务：这里只负责转发、按 id 配对、超时兜底，以及进程生命周期。
 */
class BackendProcess {
  private child: ChildProcess | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  /** stdout 是流，一条 JSON 可能被拆成多段，必须自己攒行 */
  private stdoutBuffer = ''
  private stopping = false
  private readonly binary =
    process.env.CHAT_DEEPSEEK_BIN || path.join(process.cwd(), 'chat-deepseek')
  private unavailableReason = '后端尚未启动'

  constructor(private readonly notify: (method: string, params: unknown) => void) {}

  start(): void {
    // Go 侧还没实现 ipc 子命令时，这里会拿到用法错误并退出；不能因此崩掉窗口
    const child = spawn(this.binary, ['ipc'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.consumeStdout(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => this.forwardStderr(chunk))

    // ENOENT 之类是异步 error 事件，不监听会变成未捕获异常直接杀进程
    child.on('error', (error) => {
      this.child = null
      this.failAll({ code: 'backend_unavailable', message: `无法启动后端：${error.message}` })
      this.markUnavailable(`无法启动后端 ${this.binary}：${error.message}`)
    })

    child.on('spawn', () => {
      this.unavailableReason = '后端尚未响应'
      console.log(`[backend] 已启动 ${this.binary} ipc (pid=${child.pid ?? 'unknown'})`)
      this.notify('event.backend.state', { available: true, binary: this.binary })
    })

    child.on('exit', (code, signal) => {
      this.child = null
      const detail = `code=${code ?? 'null'} signal=${signal ?? 'null'}`
      this.failAll({ code: 'backend_exited', message: `后端进程已退出（${detail}）` })
      // 主动退出（应用关闭）不算异常，不必再广播
      if (!this.stopping) {
        this.markUnavailable(`后端进程已退出（${detail}）`)
      }
    })
  }

  /** 转发一次请求；任何失败都以 HostErrorPayload reject，绝不让调用方永久挂起 */
  async request(method: string, params?: unknown): Promise<unknown> {
    const stdin = this.child?.stdin
    if (!stdin || !stdin.writable) {
      const failure: HostErrorPayload = {
        code: 'backend_unavailable',
        message: this.unavailableReason,
      }
      throw failure
    }

    const id = this.nextId++
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const failure: HostErrorPayload = {
          code: 'timeout',
          message: `请求 ${method} 超过 ${REQUEST_TIMEOUT_MS}ms 未响应`,
        }
        reject(failure)
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })

      const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`
      const failWrite = (message: string): void => {
        this.settle(id, { code: 'backend_unavailable', message })
      }
      try {
        stdin.write(line, (error) => {
          if (error) {
            failWrite(`写入后端失败：${error.message}`)
          }
        })
      } catch (error) {
        failWrite(`写入后端失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  /** 应用退出时调用；先按协议 EOF，再用 SIGTERM 兜底，避免留下孤儿进程 */
  stop(): void {
    this.stopping = true
    const child = this.child
    this.child = null
    if (!child) {
      return
    }
    child.stdin?.end()
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }
    child.kill('SIGTERM')
  }

  private settle(id: number, failure: HostErrorPayload): void {
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.reject(failure)
  }

  private failAll(failure: HostErrorPayload): void {
    for (const [id] of this.pending) {
      this.settle(id, failure)
    }
  }

  private markUnavailable(reason: string): void {
    this.unavailableReason = reason
    console.error(`[backend] ${reason}`)
    this.notify('event.backend.state', { available: false, reason })
  }

  /** 按行切分 stdout；不完整的尾巴留在 buffer 里等下一段 */
  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line !== '') {
        this.handleLine(line)
      }
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let message: RpcMessage
    try {
      message = JSON.parse(line) as RpcMessage
    } catch {
      console.error(`[backend] 收到非法 JSON：${line.slice(0, 200)}`)
      return
    }
    if (typeof message !== 'object' || message === null) {
      return
    }

    // 事件帧没有 id，只带 method
    if (typeof message.id !== 'number') {
      if (typeof message.method === 'string' && message.method !== '') {
        this.notify(message.method, message.params)
        return
      }
      console.error(`[backend] 无法匹配的报文：${line.slice(0, 200)}`)
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) {
      console.error(`[backend] 未知 id 的响应：${line.slice(0, 200)}`)
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(message.id)

    if (message.error !== undefined && message.error !== null) {
      pending.reject(toHostError(message.error))
      return
    }
    pending.resolve(message.result)
  }

  /** stderr 是排障主通道，不能丢：按行加前缀转到主进程 console */
  private forwardStderr(chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim() !== '') {
        console.error(`[backend] ${line}`)
      }
    }
  }
}

let mainWindow: BrowserWindow | null = null
let backend: BackendProcess | null = null

/** 主进程 -> 渲染层事件；窗口还没建好时静默丢弃，不缓存 */
function sendToRenderer(method: string, params: unknown): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) {
    return
  }
  win.webContents.send(EVENT_CHANNEL, method, params)
}

function registerIpc(): void {
  ipcMain.handle(
    REQUEST_CHANNEL,
    async (_event, method: unknown, params: unknown): Promise<HostReply> => {
      if (typeof method !== 'string' || method === '') {
        return { ok: false, error: { code: 'invalid_request', message: 'method 必须是非空字符串' } }
      }
      if (!backend) {
        return { ok: false, error: { code: 'backend_unavailable', message: '后端尚未启动' } }
      }
      try {
        return { ok: true, result: await backend.request(method, params) }
      } catch (error) {
        return { ok: false, error: toHostError(error) }
      }
    }
  )
}

function createWindow(): void {
  const win = new BrowserWindow({
    title: 'chat-deepseek',
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    // 先隐藏：正常模式 ready-to-show 再显示（避免白闪），冒烟模式永远不显示
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win

  if (smoke) {
    // 冒烟模式绝不显示窗口：用 did-finish-load 判断渲染层已就绪，
    // 不依赖 ready-to-show（那个和首次绘制相关，隐藏窗口不许我们拿它当门槛）
    win.webContents.once('did-finish-load', () => {
      console.log('[smoke] renderer loaded (window hidden)')
      // 两条链路各走一遍：主进程直连后端、渲染层经 preload → ipcMain
      void backend?.request('system.capabilities').then(
        (result) => console.log('[smoke] main->backend', JSON.stringify(result)),
        (error: unknown) => console.log('[smoke] main->backend failed', JSON.stringify(error))
      )
      void win.webContents
        .executeJavaScript(
          "window.host.request('system.status').then((r) => JSON.stringify(r), (e) => 'ERR:' + e.code)"
        )
        .then(
          (text: unknown) => console.log('[smoke] renderer->host', String(text)),
          (error: unknown) => console.log('[smoke] renderer->host failed', String(error))
        )
      setTimeout(() => app.quit(), 800)
    })
  } else {
    win.once('ready-to-show', () => {
      win.show()
    })
  }
  // 默认菜单被去掉后，开发时用 F12 打开 DevTools（生产不注册）
  if (isDev) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools()
      }
    })
  }
  win.on('closed', () => {
    mainWindow = null
  })

  // 开发时可选指到 rspack dev server（8092）拿 HMR；生产始终走打包好的 file://
  const devServerUrl = isDev ? process.env.CHAT_DEEPSEEK_RENDERER_URL : undefined
  const page = path.join(__dirname, 'renderer', 'index.html')
  if (devServerUrl) {
    console.log(`[main] 加载 dev server：${devServerUrl}`)
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(page)
  }
}

function bootstrap(): void {
  backend = new BackendProcess(sendToRenderer)
  backend.start()
  registerIpc()
  createWindow()
}

// 单实例：两个进程会各自 spawn 一个 Go 后端，锁失败方直接退出
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 冒烟模式没有可见窗口，别为了「聚焦」把窗口弹出来
    if (smoke) {
      return
    }
    const win = mainWindow
    if (!win) {
      return
    }
    if (win.isMinimized()) {
      win.restore()
    }
    win.show()
    win.focus()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // 先杀子进程再让进程退出；不等它收尾，避免关闭卡住
  app.on('before-quit', () => {
    backend?.stop()
  })

  // 系统主题切换时更新窗口底色，新页面加载前不会闪回另一种底色
  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(
      nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND
    )
  })

  if (smoke) {
    // 渲染层一直没加载完就兜底失败退出，避免 CI 卡死
    const watchdog = setTimeout(() => {
      console.error('[smoke] 渲染层未在 4.5s 内完成加载')
      cleanupSmokeUserData()
      app.exit(1)
    }, 4_500)
    watchdog.unref()
    app.on('quit', () => {
      clearTimeout(watchdog)
      cleanupSmokeUserData()
    })
  }

  app.whenReady().then(
    () => {
      // 去掉 Electron 默认的 File/Edit/View/Window 菜单：在 Linux 上它会渲染成窗口内的一条
      // 老式菜单栏，是最容易让应用显得"上个时代"的一处。快捷键另在窗口层注册。
      Menu.setApplicationMenu(null)
      bootstrap()
    },
    (error: unknown) => {
      console.error('[main] 初始化失败：', error)
      app.exit(1)
    }
  )
}
