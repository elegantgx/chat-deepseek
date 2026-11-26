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
  if (value === undefined) {
    return ['User']
  }
  if (!Array.isArray(value)) {
    fail('bad_request', '参数必须是 JSON 对象且 groups 是数组')
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
  pid: number
  installed: boolean
  unitPath: string
  config: ConfigProjection
  backups: BackupEntry[]
  accounts: AccountRow[]
  auth: AuthState
  logs: string[]
}

/** hash 里的后缀只影响替身：`-off` 让服务初始为已停止、`empty` 清空备份、`login` 未登录 */
function hashFlags(): { running: boolean; emptyBackups: boolean; signedOut: boolean } {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return {
    running: !/(^|-)off($|-)/.test(raw),
    emptyBackups: /(^|-)empty($|-)/.test(raw),
    signedOut: /(^|-)login($|-)/.test(raw),
  }
}

export function createMockHost(): HostClient {
  const now = new Date()
  const flags = hashFlags()
  const state: MockState = {
    running: flags.running,
    pid: 4821,
    installed: true,
    unitPath: '~/.config/systemd/user/chat-deepseek.service',
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
    logs: [
      'serve listening on 127.0.0.1:8091',
      'database opened: data/chat.db (journal=wal)',
      'webui embedded build 0.1.4-official0.1.4',
      'login ok user=gx ip=127.0.0.1',
      'session 9f3c…31 created (branch main)',
      'settings updated: theme=system lang=zh',
      'session 9f3c…31 saved version=42 (18ms)',
      'stream proxy deepseek-chat 128 tok/s',
      'backup skipped: wal file present',
      'restore failed: service is running',
      'GET /api/service 200 (3ms)',
      'GET /api/sessions 200 (7ms)',
      'POST /api/chat/stream 200 (1.2s)',
      'session 9f3c…31 saved version=43 (12ms)',
      'attachment stored: 7f2a…c9 (42.1 KB)',
    ],
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
      state: state.running ? 'running' : 'stopped',
      listen: state.config.listen,
      source: 'probe',
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

  const appendLog = (line: string) => {
    state.logs.push(line)
    const event: ServiceLogEvent = { line, stream: 'stdout' }
    emit('event.service.log', event)
  }

  const handlers: Record<string, (params: unknown) => unknown> = {
    'system.status': () => status(),
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
    'config.set': (params) => {
      const payload = requireObject(params)
      for (const field of ['listen', 'backupDir', 'apiOrigin'] as const) {
        const value = payload[field]
        if (value === undefined) {
          continue
        }
        if (typeof value !== 'string' || value.trim() === '') {
          fail('bad_request', `${field} 不能为空`)
        }
        state.config[field] = value
      }
      return { ...state.config }
    },
    'backup.list': () => listBackups(),
    'backup.create': () => {
      if (state.running) {
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
      if (state.running) {
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
      if (state.running) {
        return {
          state: 'running',
          pid: state.pid,
          listen: state.config.listen,
        } satisfies ServiceStartResult
      }
      state.running = true
      appendLog('serve listening on ' + state.config.listen)
      appendLog('database opened: data/chat.db (journal=wal)')
      return {
        state: 'running',
        pid: state.pid,
        listen: state.config.listen,
      } satisfies ServiceStartResult
    },
    'service.stop': () => {
      if (!state.running) {
        fail('unavailable', '服务未运行')
      }
      state.running = false
      appendLog('Stopping chat-deepseek.service…')
      appendLog('Stopped chat-deepseek.service.')
      return { state: 'stopped' } satisfies ServiceStopResult
    },
    'service.restart': () => {
      state.running = true
      appendLog('Stopping chat-deepseek.service…')
      appendLog('Started chat-deepseek.service.')
      appendLog('serve listening on ' + state.config.listen)
      return {
        state: 'running',
        pid: state.pid,
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
      const lines = state.logs.slice(-tail)
      return { lines, truncated } satisfies ServiceLogsResult
    },
    'service.install': () => {
      state.installed = true
      return { ok: true, unitPath: state.unitPath }
    },
    'service.uninstall': () => {
      if (!state.installed) {
        fail('unavailable', '服务未安装')
      }
      state.installed = false
      state.running = false
      return { ok: true }
    },
    'auth.whoami': () => ({ ...state.auth }),
    'auth.login': (params) => {
      const payload = requireObject(params)
      const username = requireString(payload.username, 'username')
      const password = requireString(payload.password, 'password')
      if (!state.accounts.some((row) => row.username === username) || password.length < 8) {
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
      if (password.length < 8) {
        fail('bad_request', '密码至少 8 位')
      }
      if (state.accounts.some((row) => row.username === username)) {
        fail('conflict', `用户名已存在：${username}`)
      }
      const groups = normalizeGroups(payload.groups)
      if (groups.length > 1) {
        requireGroup('Owner')
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
      if (password.length < 8) {
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
