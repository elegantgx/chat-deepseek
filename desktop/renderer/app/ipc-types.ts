/**
 * ipc 结果类型：与 `internal/ipc` 的 JSON 字段一一对应，字段名就是契约，不要重命名。
 * 页面先用 fixtures 按这些类型渲染；接真后端时只换数据来源，不动视图。
 * 方法清单与错误码见 docs/ipc.md。
 */

/** 服务探测三态；`starting` 只出现在 start/restart 的返回里 */
export type ServiceState = 'running' | 'stopped' | 'starting' | 'unknown'

export interface SystemStatus {
  version: string
  dataDir: string
  service: {
    state: ServiceState
    listen: string
    source: 'probe'
    /** systemd 用户单元是否已安装；不可用平台恒为 false */
    installed: boolean
    /** 当前平台是否有可用的 systemd 用户管理器 */
    supported: boolean
  }
}

export interface ConfigProjection {
  dataDir: string
  listen: string
  apiOrigin: string
  backupDir: string
  version: string
}

export interface BackupEntry {
  file: string
  path: string
  size: number
  /** RFC 3339，带本地时区偏移 */
  mtime: string
}

export interface BackupList {
  backups: BackupEntry[]
  dir: string
}

export interface BackupCreated {
  file: string
  path: string
  size: number
}

export interface BackupRestored {
  ok: true
  restored: string[]
}

/** 账户组是固定枚举，rank 由低到高：User < Admin < Owner */
export type AccountGroup = 'User' | 'Admin' | 'Owner'

export interface AccountRow {
  id: string
  username: string
  groups: AccountGroup[]
  disabled: boolean
  /** RFC 3339 */
  createdAt: string
  /** 是否就是当前登录的账户；删除与改密码要据此禁用 */
  self: boolean
}

export interface AccountList {
  accounts: AccountRow[]
}

/** `auth.whoami` / `auth.login` 的结果：未登录时只有 authenticated:false */
export interface AuthState {
  authenticated: boolean
  username?: string
  groups?: AccountGroup[]
  /** 会话过期时间，RFC 3339 */
  expiresAt?: string
}

export interface ServiceStartResult {
  state: 'running' | 'starting'
  pid: number
  listen: string
}

export interface ServiceStopResult {
  state: 'stopped'
}

export interface ServiceLogsResult {
  lines: string[]
  truncated: boolean
}

/** `event.service.log` 的 payload */
export interface ServiceLogEvent {
  line: string
  stream: 'stdout' | 'stderr'
}
