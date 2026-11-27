import { FIXED_CAPABILITIES, FIXED_LOG_LINES, FIXED_NEW_BACKUP } from './fixtures.js'
import {
  fail,
  FakeError,
  readAccountList,
  readAuthState,
  readBackupList,
  readServiceStatus,
  readSystemStatus,
  SCENARIO_LATENCY_MS,
  type ScenarioRuntime,
} from './state.js'

/**
 * fake 的控制面：方法与 `docs/ipc.md` 同名、同结果形状，只是数据固定。
 *
 * 只覆盖首版 36 屏会用到的集合（system/service/backup/auth/account/config）；
 * 未覆盖的方法返回 `not_found`，和真 ipc 对未知方法的处理一致，避免页面假装成功。
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const parseParams = (paramsJson: string): Record<string, unknown> => {
  if (!paramsJson.trim()) {
    return {}
  }
  const parsed: unknown = JSON.parse(paramsJson)
  return isRecord(parsed) ? parsed : {}
}

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

const normalizeGroups = (value: unknown): Array<'User' | 'Admin' | 'Owner'> => {
  if (!Array.isArray(value) || value.length === 0) {
    return ['User']
  }
  const groups: Array<'User' | 'Admin' | 'Owner'> = []
  for (const item of value) {
    if (typeof item !== 'string') {
      fail('bad_request', 'groups 只接受 User / Admin / Owner')
    }
    const canonical = item.toLowerCase()
    if (canonical === 'user') {
      groups.push('User')
    } else if (canonical === 'admin') {
      groups.push('Admin')
    } else if (canonical === 'owner') {
      groups.push('Owner')
    } else {
      fail('bad_request', 'groups 只接受 User / Admin / Owner')
    }
  }
  return groups
}

const requireAuthenticated = (runtime: ScenarioRuntime): void => {
  if (!runtime.state.authenticated) {
    fail('unauthenticated', '请先登录')
  }
}

const reply = (runtime: ScenarioRuntime, id: string, work: () => unknown): void => {
  runtime.after(id, SCENARIO_LATENCY_MS, () => {
    try {
      runtime.done(id, work())
    } catch (error) {
      if (error instanceof FakeError) {
        runtime.fail(id, { code: error.code, message: error.message })
      } else {
        runtime.fail(id, {
          code: 'internal',
          message: error instanceof Error ? error.message : '场景执行失败',
        })
      }
    }
  })
}

/** 启动成功后补投日志事件，让「运行中」不是一张静止的卡 */
const emitLogs = (runtime: ScenarioRuntime, id: string): void => {
  FIXED_LOG_LINES.forEach((line, index) => {
    runtime.after(id, index * 60, () => {
      runtime.event('event.service.log', { line, stream: 'stdout' })
    })
  })
}

const startService = (
  runtime: ScenarioRuntime
): { state: 'running'; pid: number; listen: string } => {
  if (!runtime.state.initialized) {
    fail('unavailable', '服务还没有初始化')
  }
  runtime.state.serviceState = 'running'
  return { state: 'running', pid: 4312, listen: runtime.state.config.listen }
}

export const dispatchHost = (
  runtime: ScenarioRuntime,
  id: string,
  method: string,
  paramsJson: string
): void => {
  let params: Record<string, unknown>
  try {
    params = parseParams(paramsJson)
  } catch {
    runtime.fail(id, { code: 'bad_request', message: 'params 不是合法 JSON' })
    return
  }

  switch (method) {
    case 'system.status':
      reply(runtime, id, () => readSystemStatus(runtime.state))
      return
    case 'system.capabilities':
      reply(runtime, id, () => ({
        platform: 'android',
        methods: [...FIXED_CAPABILITIES.methods],
        features: { ...FIXED_CAPABILITIES.features },
        ipcVersion: FIXED_CAPABILITIES.ipcVersion ?? 1,
      }))
      return
    case 'service.status':
      // 壳给渲染层的便捷投影（端口只从这里取）；真 ipc 没有同名方法。
      reply(runtime, id, () => readServiceStatus(runtime.state))
      return
    case 'service.start':
      reply(runtime, id, () => {
        const result = startService(runtime)
        emitLogs(runtime, id)
        return result
      })
      return
    case 'service.stop':
      reply(runtime, id, () => {
        runtime.state.serviceState = 'stopped'
        return { state: 'stopped' }
      })
      return
    case 'service.restart':
      reply(runtime, id, () => {
        const result = startService(runtime)
        emitLogs(runtime, id)
        return result
      })
      return
    case 'service.logs':
      reply(runtime, id, () => ({
        lines: runtime.state.serviceState === 'running' ? [...FIXED_LOG_LINES] : [],
        truncated: false,
      }))
      return
    case 'service.install':
    case 'service.uninstall':
      reply(runtime, id, () => fail('unsupported', 'Android 不需要 systemd 用户单元'))
      return
    case 'config.get':
      reply(runtime, id, () => ({ ...runtime.state.config }))
      return
    case 'config.set':
      reply(runtime, id, () => {
        const next = { ...runtime.state.config }
        const listen = readString(params.listen)
        const apiOrigin = readString(params.apiOrigin)
        const backupDir = params.backupDir === '' ? null : readString(params.backupDir)
        if (listen !== null) {
          next.listen = listen
        }
        if (apiOrigin !== null) {
          next.apiOrigin = apiOrigin
        }
        if (backupDir !== null) {
          next.backupDir = backupDir
        }
        if (params.backupDir === '') {
          next.backupDir = `${next.dataDir}/backups`
        }
        runtime.state.config = next
        return { ...next }
      })
      return
    case 'backup.list':
      reply(runtime, id, () => readBackupList(runtime.state))
      return
    case 'backup.create':
      reply(runtime, id, () => {
        if (runtime.state.serviceState === 'running') {
          fail('unavailable', '服务运行中，备份已暂停')
        }
        if (!runtime.state.initialized) {
          fail('not_found', '数据目录里还没有数据库')
        }
        runtime.state.backups.unshift({ ...FIXED_NEW_BACKUP })
        return {
          file: FIXED_NEW_BACKUP.file,
          path: FIXED_NEW_BACKUP.path,
          size: FIXED_NEW_BACKUP.size,
        }
      })
      return
    case 'backup.restore': {
      const file = readString(params.file)
      reply(runtime, id, () => {
        if (runtime.state.serviceState === 'running') {
          fail('unavailable', '服务运行中，恢复已暂停')
        }
        if (!file || !runtime.state.backups.some((entry) => entry.file === file)) {
          fail('not_found', '备份文件不存在')
        }
        return { ok: true, restored: ['chat.db', 'config.json'] }
      })
      return
    }
    case 'backup.delete': {
      const file = readString(params.file)
      reply(runtime, id, () => {
        const index = runtime.state.backups.findIndex((entry) => entry.file === file)
        if (index === -1) {
          fail('not_found', '备份文件不存在')
        }
        runtime.state.backups.splice(index, 1)
        return { ok: true }
      })
      return
    }
    case 'auth.whoami':
      reply(runtime, id, () => readAuthState(runtime.state))
      return
    case 'auth.login': {
      const username = readString(params.username)?.trim() ?? ''
      const password = readString(params.password) ?? ''
      reply(runtime, id, () => {
        if (!runtime.state.initialized) {
          fail('unauthenticated', '账户不存在')
        }
        if (username !== 'gx' || password !== 'demo1234') {
          fail('unauthenticated', '密码错误')
        }
        runtime.state.authenticated = true
        return readAuthState(runtime.state)
      })
      return
    }
    case 'auth.setup': {
      const username = readString(params.username)?.trim() ?? ''
      const password = readString(params.password) ?? ''
      reply(runtime, id, () => {
        if (runtime.state.initialized) {
          fail('conflict', '这个数据目录已经有用户了；请直接登录')
        }
        if (!USERNAME_PATTERN.test(username)) {
          fail('bad_request', '用户名只能用 1–64 个字母、数字或 . _ -')
        }
        if (password.length < 8) {
          fail('bad_request', '密码至少 8 位')
        }
        runtime.state.accounts = [
          {
            id: `acc_${username}`,
            username,
            groups: ['User', 'Owner'],
            disabled: false,
            createdAt: '2026-11-27T16:00:00+08:00',
            self: true,
          },
        ]
        runtime.state.initialized = true
        runtime.state.authenticated = true
        runtime.state.backups = []
        return readAuthState(runtime.state)
      })
      return
    }
    case 'auth.logout':
      reply(runtime, id, () => {
        runtime.state.authenticated = false
        return { ok: true }
      })
      return
    case 'account.list':
      reply(runtime, id, () => {
        requireAuthenticated(runtime)
        return readAccountList(runtime.state)
      })
      return
    case 'account.add': {
      const username = readString(params.username)?.trim() ?? ''
      const password = readString(params.password) ?? ''
      const groups = normalizeGroups(params.groups)
      reply(runtime, id, () => {
        requireAuthenticated(runtime)
        if (!USERNAME_PATTERN.test(username)) {
          fail('bad_request', '用户名只能用 1–64 个字母、数字或 . _ -')
        }
        if (password.length < 8) {
          fail('bad_request', '密码至少 8 位')
        }
        if (
          runtime.state.accounts.some(
            (account) => account.username.toLowerCase() === username.toLowerCase()
          )
        ) {
          fail('conflict', '用户名已被占用')
        }
        runtime.state.accounts.push({
          id: `acc_${username}`,
          username,
          groups,
          disabled: false,
          createdAt: '2026-11-27T16:00:00+08:00',
          self: false,
        })
        return { ok: true }
      })
      return
    }
    case 'account.password': {
      const username = readString(params.username) ?? ''
      const password = readString(params.password) ?? ''
      reply(runtime, id, () => {
        requireAuthenticated(runtime)
        if (!runtime.state.accounts.some((account) => account.username === username)) {
          fail('not_found', '账户不存在')
        }
        if (password.length < 8) {
          fail('bad_request', '密码至少 8 位')
        }
        return { ok: true }
      })
      return
    }
    case 'account.delete': {
      const username = readString(params.username) ?? ''
      reply(runtime, id, () => {
        requireAuthenticated(runtime)
        const index = runtime.state.accounts.findIndex((account) => account.username === username)
        if (index === -1) {
          fail('not_found', '账户不存在')
        }
        if (runtime.state.accounts[index].self) {
          fail('permission_denied', '不能删除自己')
        }
        runtime.state.accounts.splice(index, 1)
        return { ok: true }
      })
      return
    }
    default:
      reply(runtime, id, () => fail('not_found', `未知方法 "${method}"`))
  }
}
