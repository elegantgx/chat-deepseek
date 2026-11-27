import { deliverChunk, deliverDone, emitBridgeEvent } from '../bridge/callbacks.js'
import { encodeText } from '../bridge/codec.js'
import type { BridgeError } from '../bridge/types.js'
import {
  createAccounts,
  createBackups,
  FIXED_AUTH_EXPIRES,
  FIXED_DATA_DIR,
  FIXED_LISTEN,
  FIXED_PREFERENCES,
  FIXED_VERSION,
  SCENARIOS,
  type FakeAccountRow,
  type FakeBackupEntry,
  type ScenarioId,
} from './fixtures.js'
import type { ShellLocale, ShellServerKind } from '../bridge/types.js'
import { createChatHistory, emptyChatHistory, type ChatHistory } from './chats.js'

/**
 * fake 的运行时状态。
 *
 * 每个页面加载创建一份；写方法（启停服务、建备份、加账户）只改这份内存状态，
 * 所以真实交互和截图都从同一个起点出发，刷新即复位。
 */

export interface FakeServiceStatus {
  state: 'running' | 'stopped'
  listen: string
  source: 'probe'
  mode: 'process'
  installed: boolean
  supported: boolean
  linger: boolean
}

export interface FakeSystemStatus {
  version: string
  dataDir: string
  service: FakeServiceStatus
}

export interface FakeAuthState {
  authenticated: boolean
  initialized: boolean
  username?: string
  groups?: string[]
  expiresAt?: string
}

export interface FakeConfigProjection {
  dataDir: string
  listen: string
  apiOrigin: string
  backupDir: string
  version: string
}

export interface TempFile {
  meta: { name: string; mime: string; size: number }
  chunks: Uint8Array[]
  closed: boolean
}

export interface ScenarioState {
  scenario: ScenarioId
  /** 当前选中服务器的类型；决定 net 是走本机还是远程 */
  selectedKind: ShellServerKind | null
  /** `?locale=` 覆盖后的界面语言；设置接口回写它，英文截图才有稳定来源 */
  locale: ShellLocale
  /** `/api/v1/settings` 的内存投影，PUT 后整份回显 */
  preferences: Record<string, unknown>
  serviceState: 'running' | 'stopped'
  authenticated: boolean
  initialized: boolean
  backups: FakeBackupEntry[]
  accounts: FakeAccountRow[]
  /** 固定会话；默认场景为空，`chat-history` 才有数据 */
  chats: ChatHistory
  config: FakeConfigProjection
  tempFiles: Map<string, TempFile>
}

export interface ScenarioRuntime {
  state: ScenarioState
  /** 固定延迟后执行；按 id 记账，abort(id) 能清掉整条流的所有定时器 */
  after(id: string, delayMs: number, task: () => void): void
  cancel(id: string): void
  done(id: string, result: unknown): void
  fail(id: string, error: BridgeError): void
  /** 投递一条文本 chunk（内部转 bytes），供 SSE 用 */
  chunkText(id: string, text: string): void
  event(method: string, params: unknown): void
}

/** 控制面错误：字段与 `docs/ipc.md` 的错误对象一致 */
export class FakeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FakeError'
    this.code = code
  }
}

/** 在 fake 的写方法里快速失败；调用方统一 catch FakeError 转成 done 错误信封 */
export const fail = (code: string, message: string): never => {
  throw new FakeError(code, message)
}

/** 场景可以覆盖“当前账户”的显示名：示意里抽屉写 owner，账户列表却写 gx */
const renameSelf = (accounts: FakeAccountRow[], username?: string): FakeAccountRow[] => {
  if (!username) {
    return accounts
  }
  return accounts.map((account) => (account.self ? { ...account, username } : account))
}

export const createState = (scenario: ScenarioId, locale: ShellLocale = 'zh-CN'): ScenarioState => {
  const profile = SCENARIOS[scenario]
  return {
    scenario,
    selectedKind: profile.servers.find((server) => server.id === profile.selectedId)?.kind ?? null,
    locale,
    preferences: { ...FIXED_PREFERENCES, locale },
    serviceState: profile.serviceState,
    authenticated: profile.authenticated,
    initialized: profile.initialized,
    backups: profile.initialized ? createBackups() : [],
    accounts: profile.initialized ? renameSelf(createAccounts(), profile.selfUsername) : [],
    chats: profile.chatHistory
      ? createChatHistory(profile.chatHistoryMode === 'drawer' ? 'drawer' : 'rich')
      : emptyChatHistory(),
    config: {
      dataDir: FIXED_DATA_DIR,
      listen: FIXED_LISTEN,
      apiOrigin: 'https://api.deepseek.com',
      backupDir: `${FIXED_DATA_DIR}/backups`,
      version: FIXED_VERSION,
    },
    tempFiles: new Map(),
  }
}

/** 服务投影；`system.status` 与壳的 `service.status` 共用 */
export const readServiceStatus = (state: ScenarioState): FakeServiceStatus => ({
  state: state.serviceState,
  listen: state.config.listen,
  source: 'probe',
  mode: 'process',
  installed: true,
  supported: false,
  linger: false,
})

export const readSystemStatus = (state: ScenarioState): FakeSystemStatus => ({
  version: FIXED_VERSION,
  dataDir: state.config.dataDir,
  service: readServiceStatus(state),
})

const currentUsername = (state: ScenarioState): string =>
  state.accounts.find((account) => account.self)?.username ?? 'gx'

export const readAuthState = (state: ScenarioState): FakeAuthState =>
  state.authenticated
    ? {
        authenticated: true,
        initialized: state.initialized,
        username: currentUsername(state),
        groups: ['User', 'Owner'],
        expiresAt: FIXED_AUTH_EXPIRES,
      }
    : { authenticated: false, initialized: state.initialized }

export const readBackupList = (
  state: ScenarioState
): { backups: FakeBackupEntry[]; dir: string } => ({
  backups: state.backups.map((entry) => ({ ...entry })),
  dir: state.config.backupDir,
})

export const readAccountList = (state: ScenarioState): { accounts: FakeAccountRow[] } => ({
  accounts: state.accounts.map((account) => ({ ...account, groups: [...account.groups] })),
})

/** 当前选中服务器是否真的能发 HTTP；停止/未初始化时 net 一律走可复现的 network 错误 */
export const isNetReachable = (state: ScenarioState): boolean => {
  if (state.selectedKind === null) {
    return false
  }
  if (state.selectedKind === 'remote') {
    return true
  }
  return state.serviceState === 'running'
}

/** 固定延迟：够让加载态出现，又不会把截图脚本拖慢 */
export const SCENARIO_LATENCY_MS = 240
export const NET_LATENCY_MS = 120

export const createRuntime = (state: ScenarioState): ScenarioRuntime => {
  const timers = new Map<string, Set<ReturnType<typeof setTimeout>>>()

  const after = (id: string, delayMs: number, task: () => void): void => {
    const timer = setTimeout(() => {
      const group = timers.get(id)
      group?.delete(timer)
      if (group && group.size === 0) {
        timers.delete(id)
      }
      task()
    }, delayMs)
    const group = timers.get(id) ?? new Set<ReturnType<typeof setTimeout>>()
    group.add(timer)
    timers.set(id, group)
  }

  const cancel = (id: string): void => {
    const group = timers.get(id)
    if (!group) {
      return
    }
    for (const timer of group) {
      clearTimeout(timer)
    }
    timers.delete(id)
  }

  return {
    state,
    after,
    cancel,
    done: (id, result) => {
      deliverDone(id, { ok: true, result })
    },
    fail: (id, error) => {
      deliverDone(id, { ok: false, error })
    },
    chunkText: (id, text) => {
      deliverChunk(id, encodeText(text))
    },
    event: (method, params) => {
      emitBridgeEvent(method, params)
    },
  }
}
