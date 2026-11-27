import type { ShellCapabilities, ShellLocale, ShellReady, ShellServer } from '../bridge/types.js'

/**
 * 可复现 fake 的唯一数据源：固定时间、固定文案、固定延迟、固定错误路径。
 *
 * 这里刻意不读 `Date.now()`、不读浏览器语言：截图回归要的是「同一次运行内两次渲染
 * 完全一样」，任何随时间/环境变化的值都会让 diff 抖动。需要新 fixture 时只加常量。
 */

export const SCENARIO_IDS = [
  'local-installed',
  'local-uninitialized',
  'local-stopped',
  'remote-connected',
  'chat-history',
  'chat-empty',
  'chat-drawer',
] as const

export type ScenarioId = (typeof SCENARIO_IDS)[number]

export const DEFAULT_SCENARIO: ScenarioId = 'local-installed'

export const isScenarioId = (value: string): value is ScenarioId =>
  (SCENARIO_IDS as readonly string[]).includes(value)

/** `?scenario=` 不认识时静默回到默认场景，截图脚本写错不至于白屏 */
export const parseScenarioId = (value: string | null | undefined): ScenarioId =>
  value && isScenarioId(value) ? value : DEFAULT_SCENARIO

export const FIXED_VERSION = '0.1.5-official0.1.4'
export const FIXED_DATA_DIR = '/data/user/0/dev.chatdeepseek/files/data'
export const FIXED_LISTEN = '127.0.0.1:8091'
export const LOCAL_SERVER_ID = 'local'
export const REMOTE_SERVER_ID = 'remote-home'
/** 固定登录态过期时间；不用 Date 计算，换机器也不会变 */
export const FIXED_AUTH_EXPIRES = '2026-11-28T00:00:00+08:00'
export const FIXED_SESSION_EXPIRES = 1795795200000
export const FIXED_UPDATED_AT = 1795766400

const LOCAL_SERVER: ShellServer = {
  id: LOCAL_SERVER_ID,
  kind: 'local',
  name: '本机',
  mode: 'installed',
  baseUrl: `http://${FIXED_LISTEN}`,
}

const REMOTE_SERVER: ShellServer = {
  id: REMOTE_SERVER_ID,
  kind: 'remote',
  name: 'Home',
  mode: 'installed',
  baseUrl: 'https://chat.example.com',
}

/** 与 `docs/ipc.md` §4.2 的本版方法表一致 */
export const FIXED_METHODS = [
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
  'auth.whoami',
  'auth.login',
  'auth.setup',
  'auth.logout',
  'account.list',
  'account.add',
  'account.password',
  'account.delete',
  'config.set',
  'service.install',
  'service.uninstall',
]

export const FIXED_CAPABILITIES: ShellCapabilities = {
  methods: FIXED_METHODS,
  ipcVersion: 1,
  features: { systemd: false, ssh: false, autostart: false, backup: true, service: true },
}

export interface ScenarioProfile {
  servers: ShellServer[]
  selectedId: string | null
  serviceState: 'running' | 'stopped'
  authenticated: boolean
  initialized: boolean
  /** 是否带上固定的聊天历史；默认场景保持空，避免影响其它屏的截图 */
  chatHistory: boolean
  /** 历史内容的形态：`rich` 覆盖思考/代码/分支，`drawer` 对齐 chat-drawer 示意 */
  chatHistoryMode?: 'rich' | 'drawer'
  /** 覆盖当前登录账户名；示意里抽屉底部写的是 owner，和账户列表的 gx 不一致 */
  selfUsername?: string
}

const withLocalMode = (mode: ShellServer['mode']): ShellServer => ({ ...LOCAL_SERVER, mode })

/**
 * 六个场景覆盖 ready() 的三种本机 mode + 一台远程，另加两个聊天数据场景：
 * - `local-installed`：本机已安装并运行，远程只是列表里的第二条；
 * - `local-uninitialized`：本机未初始化，net 全部连不上；
 * - `local-stopped`：本机已安装但服务停止，用来验证「启动服务」与 net 错误路径；
 * - `remote-connected`：选中远程，本机 ipc 仍在（管理入口应被隐藏）；
 * - `chat-history`：固定 3 条会话，聊天屏与抽屉有内容可截；
 * - `chat-empty`：显式空列表，和默认场景分开。
 * 除 `chat-history` 外，其它场景的会话列表都保持空，避免影响已有屏的截图。
 */
export const SCENARIOS: Record<ScenarioId, ScenarioProfile> = {
  'local-installed': {
    servers: [{ ...LOCAL_SERVER }, { ...REMOTE_SERVER }],
    selectedId: LOCAL_SERVER_ID,
    serviceState: 'running',
    authenticated: true,
    initialized: true,
    chatHistory: false,
  },
  'local-uninitialized': {
    servers: [withLocalMode('uninitialized')],
    selectedId: LOCAL_SERVER_ID,
    serviceState: 'stopped',
    authenticated: false,
    initialized: false,
    chatHistory: false,
  },
  'local-stopped': {
    servers: [{ ...LOCAL_SERVER, mode: 'stopped' }, { ...REMOTE_SERVER }],
    selectedId: LOCAL_SERVER_ID,
    serviceState: 'stopped',
    authenticated: true,
    initialized: true,
    chatHistory: false,
  },
  'remote-connected': {
    servers: [{ ...LOCAL_SERVER }, { ...REMOTE_SERVER }],
    selectedId: REMOTE_SERVER_ID,
    serviceState: 'running',
    authenticated: true,
    initialized: true,
    chatHistory: false,
  },
  // 聊天屏专用：固定历史。放在独立场景里，默认场景仍是空列表。
  'chat-history': {
    servers: [{ ...LOCAL_SERVER }, { ...REMOTE_SERVER }],
    selectedId: LOCAL_SERVER_ID,
    serviceState: 'running',
    authenticated: true,
    initialized: true,
    chatHistory: true,
  },
  // 抽屉截图专用：三条会话不变，但第一条换成与示意逐字一致的简化会话
  'chat-drawer': {
    servers: [{ ...LOCAL_SERVER }, { ...REMOTE_SERVER }],
    selectedId: LOCAL_SERVER_ID,
    serviceState: 'running',
    authenticated: true,
    initialized: true,
    chatHistory: true,
    chatHistoryMode: 'drawer',
    selfUsername: 'owner',
  },
  // 聊天屏专用：显式空态，和“没有 query”的默认场景分开，截图用
  'chat-empty': {
    servers: [{ ...LOCAL_SERVER }, { ...REMOTE_SERVER }],
    selectedId: LOCAL_SERVER_ID,
    serviceState: 'running',
    authenticated: true,
    initialized: true,
    chatHistory: false,
  },
}

/** 生成 ready()；每次返回新对象，避免调用方改到场景表 */
export const createReady = (scenario: ScenarioId, locale: ShellLocale = 'zh-CN'): ShellReady => {
  const profile = SCENARIOS[scenario]
  return {
    version: FIXED_VERSION,
    dataDir: FIXED_DATA_DIR,
    theme: 'system',
    locale,
    capabilities: {
      ...FIXED_CAPABILITIES,
      methods: [...FIXED_CAPABILITIES.methods],
    },
    servers: profile.servers.map((server) => ({ ...server })),
    selectedId: profile.selectedId,
  }
}

export interface FakeBackupEntry {
  file: string
  path: string
  size: number
  /** RFC 3339，带本地时区偏移；固定字符串避免时区差异 */
  mtime: string
}

const backup = (name: string, size: number, mtime: string): FakeBackupEntry => ({
  file: `chat-deepseek-${name}.zip`,
  path: `${FIXED_DATA_DIR}/backups/chat-deepseek-${name}.zip`,
  size,
  mtime,
})

/** 新建备份永远排第一，列表顺序固定 */
export const createBackups = (): FakeBackupEntry[] => [
  backup('20261126-021400', 50529024, '2026-11-26T02:14:00+08:00'),
  backup('20261125-021400', 50200576, '2026-11-25T02:14:00+08:00'),
  backup('20261124-021400', 49676288, '2026-11-24T02:14:00+08:00'),
  backup('20261123-021400', 49029120, '2026-11-23T02:14:00+08:00'),
  backup('20261122-021400', 48758784, '2026-11-22T02:14:00+08:00'),
]

/** 新建备份的固定归档（时间写死在文件名里，不跟系统时钟走） */
export const FIXED_NEW_BACKUP = backup('20261127-021400', 50855936, '2026-11-27T02:14:00+08:00')

export interface FakeAccountRow {
  id: string
  username: string
  groups: Array<'User' | 'Admin' | 'Owner'>
  disabled: boolean
  createdAt: string
  self: boolean
}

export const createAccounts = (): FakeAccountRow[] => [
  {
    id: 'acc_gx',
    username: 'gx',
    groups: ['User', 'Owner'],
    disabled: false,
    createdAt: '2026-11-02T09:14:00+08:00',
    self: true,
  },
  {
    id: 'acc_alice',
    username: 'alice',
    groups: ['User'],
    disabled: false,
    createdAt: '2026-11-02T10:20:00+08:00',
    self: false,
  },
]

/** `/api/v1/settings` 的固定响应 */
export const FIXED_PREFERENCES = {
  locale: 'zh-CN',
  themePreference: 'system',
  location: null,
  ttsVoice: 'stella',
  thinking: true,
  // 示意里欢迎页/抽屉的「深度思考」「智能搜索」两个 chip 都是开启态；
  // fixture 跟着示意走，截图对比才有意义（真实默认值由服务端设置决定，不在这里表态）。
  search: true,
  siderCollapsed: false,
}

export const FIXED_LOG_LINES = [
  '16:09:58 INFO serve listening on 127.0.0.1:8091',
  '16:09:58 INFO database opened: data/chat.db (journal=wal)',
  '16:09:59 INFO webui embedded build 0.1.5-official0.1.4',
]

/** 1×1 PNG，够验证「附件二进制」能过桥且不会把字符串当字节 */
export const FIXED_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * 一段固定 SSE：思考 → 正文 → 结束。
 * 每个元素是一条完整事件（不带结尾空行），fake 逐条投递，用来验证 chunk 拼接。
 */
export const FIXED_SSE_EVENTS = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"scenario-message","model":"deepseek-v4-pro"}}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"这是本地复现的思考过程。"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"这是没有后端时的固定回复。"}}',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"\\n\\n- 固定文案\\n- 固定延迟\\n- 固定错误路径"}}',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
]
