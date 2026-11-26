import type {
  AccountGroup,
  AccountList,
  AccountRow,
  AuthState,
  BackupCreated,
  BackupEntry,
  BackupList,
  BackupRestored,
  ConfigProjection,
  ServiceLogEvent,
  ServiceLogsResult,
  ServiceMode,
  ServiceStartResult,
  ServiceStopResult,
  SystemStatus,
} from './ipc-types'
import type { HostClient, HostError } from './host'

/**
 * 浏览器里直接打开渲染层时的后端替身：没有 preload，`window.host` 不存在，
 * 但截图验收和纯前端调试要看到真实尺寸的页面，所以在这里用内存状态实现同一批方法。
 *
 * 契约与 `internal/ipc` 一致（字段、错误码、约束），所以页面不需要区分真假后端；
 * 在 Electron 里 `window.host` 存在，这份实现不会被走到。
 */

/** 模拟一次 ipc 往返，让加载态、按钮禁用这些状态在截图和手点时真的出现 */
const LATENCY_MS = 320

function delay(ms = LATENCY_MS): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function fail(code: string, message: string): never {
  const error: HostError = { code, message }
  throw error
}

function rfc3339(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

function archiveName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `chat-deepseek-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.zip`
  )
}

function clockTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 播种日志只在服务「运行中」时调用：还没启动就摆着历史日志，正是
 * 「服务没跑却像刚发生过」的观感来源。格式与真后端一致（HH:MM:SS LEVEL message），
 * 时间按 now 往前错开，避免整屏都是同一秒。
 */
function seedLogs(now: Date): string[] {
  const entries: Array<[number, 'INFO' | 'WARN' | 'ERROR', string]> = [
    [-92, 'INFO', 'serve listening on 127.0.0.1:8091'],
    [-88, 'INFO', 'database opened: data/chat.db (journal=wal)'],
    [-84, 'INFO', 'webui embedded build 0.1.4-official0.1.4'],
    [-61, 'INFO', 'login ok user=gx ip=127.0.0.1'],
    [-57, 'INFO', 'session 9f3c…31 created (branch main)'],
    [-43, 'INFO', 'settings updated: theme=system lang=zh'],
    [-31, 'INFO', 'session 9f3c…31 saved version=42 (18ms)'],
    [-24, 'INFO', 'stream proxy deepseek-chat 128 tok/s'],
    [-19, 'WARN', 'backup skipped: wal file present'],
    [-14, 'ERROR', 'restore failed: service is running'],
    [-9, 'INFO', 'GET /api/service 200 (3ms)'],
    [-7, 'INFO', 'GET /api/sessions 200 (7ms)'],
    [-5, 'INFO', 'POST /api/chat/stream 200 (1.2s)'],
    [-3, 'INFO', 'session 9f3c…31 saved version=43 (12ms)'],
    [-1, 'INFO', 'attachment stored: 7f2a…c9 (42.1 KB)'],
  ]
  return entries.map(
    ([offset, level, message]) =>
      `${clockTime(new Date(now.getTime() + offset * 1000))} ${level} ${message}`
  )
}

function seedBackups(now: Date): BackupEntry[] {
  const sizes = [48.2, 47.9, 47.1, 46.8, 46.5]
  return sizes.map((mb, index) => {
    const time = new Date(now.getTime() - index * 24 * 60 * 60 * 1000)
    time.setHours(2, 14, 0, 0)
    const file = archiveName(time)
    return {
      file,
      path: `/home/<user>/chat-deepseek/data/backups/${file}`,
      size: Math.round(mb * 1024 * 1024),
      mtime: rfc3339(time),
    }
  })
}

function seedAccounts(): AccountRow[] {
  return [
    {
      id: 'acc_gx',
      username: 'gx',
      groups: ['Admin', 'User'],
      disabled: false,
      createdAt: '2026-11-02T09:14:00+08:00',
      self: true,
    },
    {
      id: 'acc_chen',
      username: 'chen',
      groups: ['User'],
      disabled: false,
      createdAt: '2026-11-20T14:30:00+08:00',
      self: false,
    },
    {
      id: 'acc_lin',
      username: 'lin',
      groups: ['User'],
      disabled: false,
      createdAt: '2026-11-25T20:07:00+08:00',
      self: false,
    },
    {
      id: 'acc_owner',
      username: 'owner',
      groups: ['Owner', 'User'],
      disabled: false,
      createdAt: '2026-11-26T18:40:00+08:00',
      self: false,
    },
  ]
}

const GROUP_ORDER: AccountGroup[] = ['User', 'Admin', 'Owner']

function normalizeGroups(value: unknown): AccountGroup[] {
  if (!Array.isArray(value)) {
    fail('bad_request', 'groups 必须是数组')
  }
  const groups: AccountGroup[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      fail('bad_request', 'groups 只接受 User / Admin / Owner')
    }
    const match = GROUP_ORDER.find((group) => group.toLowerCase() === item.toLowerCase())
    if (!match) {
      fail('bad_request', `未知的组：${item}`)
    }
    if (!groups.includes(match)) {
      groups.push(match)
    }
  }
  if (!groups.includes('User')) {
    groups.unshift('User')
  }
  return groups
}

function requireObject(params: unknown): Record<string, unknown> {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    fail('bad_request', '参数必须是 JSON 对象')
  }
  return params as Record<string, unknown>
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('bad_request', `缺少参数 ${field}`)
  }
  return value
}

/** 契约按 UTF-8 字节数限制密码：中文一个字符占 3 字节 */
function passwordBytes(value: string): number {
  return new TextEncoder().encode(value).length
}

/** backupDir 契约：空表示回落默认目录，非空必须是绝对路径（POSIX 或 Windows 盘符） */
function isAbsolutePath(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/])/.test(value)
}

function highestGroup(groups: AccountGroup[]): AccountGroup {
  let best: AccountGroup = 'User'
  for (const group of groups) {
    if (GROUP_ORDER.indexOf(group) > GROUP_ORDER.indexOf(best)) {
      best = group
    }
  }
  return best
}

interface MockState {
  running: boolean
  starting: boolean
  pid: number
  startTimer: number | null
  installed: boolean
  /** 当前由谁托管：启停会改写，安装/卸载也会切换，和状态卡「管理方式」对应 */
  mode: ServiceMode
  unitPath: string
  /** `desktop.dataDir.set` 保存的待生效目录；current 不跟着变，模拟重启后生效 */
  savedDataDir: string
  config: ConfigProjection
  backups: BackupEntry[]
  accounts: AccountRow[]
  auth: AuthState
  logs: string[]
}

/**
 * hash 里的后缀只影响替身：`-off` 初始停止、`empty` 清空备份、`login` 未登录、
 * `statuserr` 状态读失败、`-systemd` 初始装了 unit、`-uninstalled` 是默认本地态的显式别名。
 */
function hashFlags(): {
  running: boolean
  emptyBackups: boolean
  signedOut: boolean
  statusError: boolean
  systemd: boolean
} {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return {
    // 默认就是「没装 systemd 的本地运行」：除非显式 -off，否则服务正在跑。
    running: !/(^|-)off($|-)/.test(raw),
    emptyBackups: /(^|-)empty($|-)/.test(raw),
    signedOut: /(^|-)login($|-)/.test(raw),
    statusError: /(^|-)statuserr($|-)/.test(raw),
    systemd: /(^|-)systemd($|-)/.test(raw),
  }
}

export function createMockHost(): HostClient {
  const now = new Date()
  const flags = hashFlags()
  const state: MockState = {
    running: flags.running,
    starting: false,
    pid: 4821,
    startTimer: null,
    installed: flags.systemd,
    // 没装 unit 时运行中是 ipc 托管的本地进程；装了 unit 则归 systemd。
    mode: flags.systemd ? 'systemd' : flags.running ? 'process' : 'none',
    unitPath: '~/.config/systemd/user/chat-deepseek.service',
    savedDataDir: '',
    config: {
      dataDir: '/home/<user>/chat-deepseek/data',
      listen: '127.0.0.1:8091',
      apiOrigin: 'https://api.deepseek.com',
      backupDir: '/home/<user>/chat-deepseek/data/backups',
      version: '0.1.4-official0.1.4',
    },
    backups: flags.emptyBackups ? [] : seedBackups(now),
    accounts: seedAccounts(),
    auth: {
      authenticated: !flags.signedOut,
      username: 'gx',
      groups: ['Admin', 'User'],
      expiresAt: rfc3339(new Date(now.getTime() + 12 * 60 * 60 * 1000)),
    },
    // 只有确实在运行才播种日志；`#off` 与从未启动的本地态是空数组。
    logs: flags.running ? seedLogs(now) : [],
  }

  const listeners = new Set<(method: string, params: unknown) => void>()

  const emit = (method: string, params: unknown) => {
    for (const listener of listeners) {
      listener(method, params)
    }
  }

  const status = (): SystemStatus => ({
    version: state.config.version,
    dataDir: state.config.dataDir,
    service: {
      state: state.starting ? 'starting' : state.running ? 'running' : 'stopped',
      listen: state.config.listen,
      source: 'probe',
      mode: state.mode,
      installed: state.installed,
      // 浏览器替身只在 Linux 桌面做验收，systemd 能力固定为可用。
      supported: true,
    },
  })

  const listBackups = (): BackupList => ({
    backups: state.backups.map((entry) => ({ ...entry })),
    dir: state.config.backupDir,
  })

  const requireAuth = (): AuthState => {
    if (!state.auth.authenticated) {
      fail('unauthenticated', '未登录或登录已过期')
    }
    return state.auth
  }

  const requireGroup = (group: AccountGroup): void => {
    const auth = requireAuth()
    const level = highestGroup(auth.groups ?? ['User'])
    if (GROUP_ORDER.indexOf(level) < GROUP_ORDER.indexOf(group)) {
      fail('permission_denied', `需要 ${group} 权限`)
    }
  }

  const appendLog = (line: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => {
    // 快照与真后端一样带真实时间和级别；事件仍是原始 message，渲染层按收到时刻补时间。
    state.logs.push(`${clockTime(new Date())} ${level} ${line}`)
    const event: ServiceLogEvent = { line, stream: 'stdout' }
    emit('event.service.log', event)
  }

  /** 替身自己的 900ms 定时器：systemctl 返回时端口还没起来，和真后端一样先给 starting */
  const beginStarting = (logLines: readonly string[]) => {
    if (state.startTimer !== null) {
      window.clearTimeout(state.startTimer)
    }
    state.starting = true
    // 装不装 unit 决定由谁托管：没装就走 ipc 的本地子进程，装了就归 systemd。
    state.mode = state.installed ? 'systemd' : 'process'
    for (const line of logLines) {
      appendLog(line)
    }
    state.startTimer = window.setTimeout(() => {
      state.startTimer = null
      state.starting = false
      state.running = true
      appendLog('serve listening on ' + state.config.listen)
    }, 900)
  }

  const handlers: Record<string, (params: unknown) => unknown> = {
    'system.status': () => {
      if (flags.statusError) {
        fail('unavailable', '无法读取服务状态：探测超时')
      }
      return status()
    },
    'system.capabilities': () => ({
      platform: 'linux',
      methods: [
        'system.status',
        'system.capabilities',
        'config.get',
        'backup.list',
        'backup.create',
        'backup.restore',
        'backup.delete',
        'service.start',
        'service.stop',
        'service.restart',
        'service.logs',
        'service.install',
        'service.uninstall',
        'auth.whoami',
        'auth.login',
        'auth.logout',
        'account.list',
        'account.add',
        'account.password',
        'account.delete',
        'desktop.dataDir',
        'desktop.dataDir.set',
      ],
      features: {
        systemd: true,
        ssh: false,
        autostart: false,
        backup: true,
        service: true,
      },
      ipcVersion: 1,
    }),
    'config.get': () => ({ ...state.config }),
    /** 设置页的数据目录投影：current 是正在使用的目录，saved 是待重启生效的目录 */
    'desktop.dataDir': () => ({
      current: state.config.dataDir,
      saved: state.savedDataDir,
      envOverride: null,
      restartRequired: state.savedDataDir !== '',
    }),
    'desktop.dataDir.set': (params) => {
      const dataDir = requireString(requireObject(params).dataDir, 'dataDir')
      if (!isAbsolutePath(dataDir)) {
        fail('bad_request', 'dataDir 必须是绝对路径')
      }
      // 模拟「重启后生效」：current 保持不变，避免浏览器里假装即时生效。
      state.savedDataDir = dataDir
      return {
        current: state.config.dataDir,
        saved: state.savedDataDir,
        envOverride: null,
        restartRequired: true,
      }
    },
    'config.set': (params) => {
      const payload = requireObject(params)
      let provided = false
      for (const field of ['listen', 'backupDir', 'apiOrigin'] as const) {
        const raw = payload[field]
        if (raw === undefined) {
          continue
        }
        provided = true
        if (typeof raw !== 'string') {
          fail('bad_request', `${field} 必须是字符串`)
        }
        const value = raw.trim()
        if (field === 'backupDir') {
          // 空字符串表示清除配置，回落到 <dataDir>/backups；非空只接受绝对路径
          if (value === '') {
            state.config.backupDir = `${state.config.dataDir}/backups`
          } else if (!isAbsolutePath(value)) {
            fail('bad_request', 'backupDir 必须是绝对路径')
          } else {
            state.config.backupDir = value
          }
          continue
        }
        if (value === '') {
          fail('bad_request', `${field} 不能为空`)
        }
        state.config[field] = value
      }
      if (!provided) {
        fail('bad_request', '至少提供一个配置项：listen、backupDir、apiOrigin')
      }
      return { ...state.config }
    },
    'backup.list': () => listBackups(),
    'backup.create': () => {
      if (state.running || state.starting) {
        fail('unavailable', '服务运行中，备份已暂停')
      }
      const when = new Date()
      const file = archiveName(when)
      const entry: BackupEntry = {
        file,
        path: `${state.config.backupDir}/${file}`,
        size: Math.round(48 * 1024 * 1024),
        mtime: rfc3339(when),
      }
      state.backups.unshift(entry)
      const result: BackupCreated = { file, path: entry.path, size: entry.size }
      return result
    },
    'backup.restore': (params) => {
      const file = requireString(requireObject(params).file, 'file')
      if (state.running || state.starting) {
        fail('unavailable', '服务运行中，恢复已暂停')
      }
      if (!state.backups.some((entry) => entry.file === file)) {
        fail('not_found', `备份不存在：${file}`)
      }
      const result: BackupRestored = {
        ok: true,
        restored: ['chat.db', 'config.json', 'master.key', 'files/'],
      }
      return result
    },
    'backup.delete': (params) => {
      const file = requireString(requireObject(params).file, 'file')
      const index = state.backups.findIndex((entry) => entry.file === file)
      if (index < 0) {
        fail('not_found', `备份不存在：${file}`)
      }
      state.backups.splice(index, 1)
      return { ok: true }
    },
    'service.start': () => {
      if (state.starting) {
        fail('unavailable', '服务操作正在进行，请稍候')
      }
      if (state.running) {
        return {
          state: 'running',
          pid: state.pid,
          listen: state.config.listen,
        } satisfies ServiceStartResult
      }
      // 没装 unit 也能启动：后端会起本地 serve 子进程，systemd 只是可选的开机自启。
      beginStarting(
        state.installed ? ['Started chat-deepseek.service.'] : ['starting local serve process…']
      )
      return {
        state: 'starting',
        pid: 0,
        listen: state.config.listen,
      } satisfies ServiceStartResult
    },
    'service.stop': () => {
      if (state.starting) {
        fail('unavailable', '服务操作正在进行，请稍候')
      }
      if (!state.running) {
        fail('unavailable', '服务未运行')
      }
      state.running = false
      // 停掉之后没有托管者：装了 unit 归 systemd（stopped），否则回到 none。
      state.mode = state.installed ? 'systemd' : 'none'
      appendLog(
        state.installed ? 'Stopping chat-deepseek.service…' : 'stopping local serve process…'
      )
      appendLog(state.installed ? 'Stopped chat-deepseek.service.' : 'local serve process stopped.')
      return { state: 'stopped' } satisfies ServiceStopResult
    },
    'service.restart': () => {
      if (state.starting) {
        fail('unavailable', '服务操作正在进行，请稍候')
      }
      beginStarting(
        state.installed
          ? ['Stopping chat-deepseek.service…', 'Started chat-deepseek.service.']
          : ['restarting local serve process…']
      )
      return {
        state: 'starting',
        pid: 0,
        listen: state.config.listen,
      } satisfies ServiceStartResult
    },
    'service.logs': (params) => {
      const payload = params === undefined || params === null ? {} : requireObject(params)
      const raw = payload.tail
      let tail = 200
      let truncated = false
      if (raw !== undefined) {
        if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
          fail('bad_request', 'tail 必须是正整数')
        }
        tail = raw
        if (tail > 5000) {
          tail = 5000
          truncated = true
        }
      }
      // 没装 unit 但曾经本地启动过时，日志缓冲仍在：停止后允许回看历史。
      const lines = state.logs.slice(-tail)
      return { lines, truncated } satisfies ServiceLogsResult
    },
    'service.install': () => {
      state.installed = true
      // 安装 unit 属于高级功能：之后由 systemd 托管，状态卡的管理方式随之切换。
      state.mode = 'systemd'
      return { ok: true, unitPath: state.unitPath }
    },
    'service.uninstall': () => {
      if (!state.installed) {
        fail('unavailable', '服务未安装')
      }
      if (state.startTimer !== null) {
        window.clearTimeout(state.startTimer)
        state.startTimer = null
      }
      state.installed = false
      state.starting = false
      state.running = false
      state.mode = 'none'
      return { ok: true }
    },
    'auth.whoami': () => ({ ...state.auth }),
    'auth.login': (params) => {
      const payload = requireObject(params)
      const username = requireString(payload.username, 'username')
      const password = requireString(payload.password, 'password')
      if (!state.accounts.some((row) => row.username === username) || passwordBytes(password) < 8) {
        fail('unauthenticated', '用户名或密码错误')
      }
      const account = state.accounts.find((row) => row.username === username)
      state.auth = {
        authenticated: true,
        username,
        groups: account?.groups ?? ['User'],
        expiresAt: rfc3339(new Date(Date.now() + 12 * 60 * 60 * 1000)),
      }
      state.accounts = state.accounts.map((row) => ({ ...row, self: row.username === username }))
      return { ...state.auth }
    },
    'auth.logout': () => {
      state.auth = { authenticated: false }
      return { ok: true }
    },
    'account.list': () => {
      requireGroup('Admin')
      return {
        accounts: state.accounts.map((row) => ({ ...row, groups: [...row.groups] })),
      } satisfies AccountList
    },
    'account.add': (params) => {
      requireGroup('Admin')
      const payload = requireObject(params)
      const username = requireString(payload.username, 'username')
      const password = requireString(payload.password, 'password')
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
        fail('bad_request', '用户名需为 1-64 个字母、数字或 . _ -')
      }
      if (passwordBytes(password) < 8) {
        fail('bad_request', '密码至少 8 位')
      }
      if (state.accounts.some((row) => row.username === username)) {
        fail('conflict', `用户名已存在：${username}`)
      }
      // 契约：省略或空数组默认 User；只要显式指定了非空 groups 就需要 Owner
      let groups: AccountGroup[] = ['User']
      if (payload.groups !== undefined) {
        if (!Array.isArray(payload.groups)) {
          fail('bad_request', 'groups 必须是数组')
        }
        if (payload.groups.length > 0) {
          groups = normalizeGroups(payload.groups)
          if (highestGroup(requireAuth().groups ?? ['User']) !== 'Owner') {
            fail('permission_denied', '只有 Owner 可以指定组；Admin 只能创建普通 User')
          }
        }
      }
      state.accounts.push({
        id: `acc_${username}`,
        username,
        groups,
        disabled: false,
        createdAt: rfc3339(new Date()),
        self: false,
      })
      return { ok: true }
    },
    'account.password': (params) => {
      requireGroup('Admin')
      const payload = requireObject(params)
      const username = requireString(payload.username, 'username')
      const password = requireString(payload.password, 'password')
      if (passwordBytes(password) < 8) {
        fail('bad_request', '密码至少 8 位')
      }
      if (!state.accounts.some((row) => row.username === username)) {
        fail('not_found', `账户不存在：${username}`)
      }
      return { ok: true }
    },
    'account.delete': (params) => {
      requireGroup('Admin')
      const username = requireString(requireObject(params).username, 'username')
      const target = state.accounts.find((row) => row.username === username)
      if (!target) {
        fail('not_found', `账户不存在：${username}`)
      }
      if (target.self) {
        fail('permission_denied', '不能删除当前登录的账户')
      }
      state.accounts = state.accounts.filter((row) => row.username !== username)
      return { ok: true }
    },
  }

  return {
    mock: true,
    async request(method: string, params?: unknown): Promise<unknown> {
      const handler = handlers[method]
      if (!handler) {
        await delay(40)
        fail('not_found', `未知方法 ${method}`)
      }
      await delay()
      return handler(params)
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
