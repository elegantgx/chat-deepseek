/**
 * 备份列表的字段投影。
 *
 * `backup.list` 的返回是 ipc 契约（`docs/ipc.md` §4.4），这里不新增字段：
 * 时间、位置、大小、文件名都从响应里来；「是否正在使用」不是列表字段，
 * 由服务运行状态（`service.status`）决定，产品规则在屏内判断。
 */
export interface BackupEntry {
  file: string
  path: string
  size: number
  mtime: string
}

export interface BackupList {
  backups: BackupEntry[]
  dir: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBackupEntry = (value: unknown): value is BackupEntry =>
  isRecord(value) &&
  typeof value.file === 'string' &&
  typeof value.path === 'string' &&
  typeof value.size === 'number' &&
  typeof value.mtime === 'string'

/** 把未知的 host 响应收窄成列表；形状不对返回 null，让页面走错误分支而不是渲染半份数据 */
export const readBackupList = (value: unknown): BackupList | null => {
  if (!isRecord(value) || !Array.isArray(value.backups)) {
    return null
  }
  if (!value.backups.every(isBackupEntry)) {
    return null
  }
  return {
    backups: value.backups.map((entry) => ({ ...entry })),
    dir: typeof value.dir === 'string' ? value.dir : '',
  }
}

/** 归档时间保留服务端本地时区：`2026-11-26T02:14:00+08:00` → `2026-11-26 02:14` */
export const formatBackupTime = (value: string): string => {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value)
  return match ? `${match[1]} ${match[2]}` : value
}

/** 文件大小按 1 位小数展示；截图里的 48.2 MB 就是 50529024 字节 */
export const formatBackupSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const normalizePath = (value: string): string => value.replace(/\/+$/, '')

/**
 * 详情里的“位置”只写用户能认出的短路径。
 *
 * 示意写 `data/backups`：它是数据目录父级下的相对路径，既不是绝对路径也不是只有末两段。
 * 自定义备份目录不在数据目录里时退回末两段，保证 390 宽不会出现省略号。
 */
export const formatBackupLocation = (dir: string, dataDir: string): string => {
  const target = normalizePath(dir)
  const data = normalizePath(dataDir)
  if (!target) {
    return dir
  }
  if (data) {
    const parent = data.slice(0, data.lastIndexOf('/'))
    if (parent && target.startsWith(`${parent}/`)) {
      return target.slice(parent.length + 1)
    }
  }
  const parts = target.split('/').filter(Boolean)
  return parts.length > 2 ? parts.slice(-2).join('/') : target
}

/**
 * `service.status` 的 `state` 才是「端口是否通」的权威字段；`mode` 回答谁在管服务，
 * 不能拿来推断运行中。为了兼容壳可能投影成服务器三态（installed/stopped）的旧形状，
 * 这里只在 `state` 缺失时才看 `mode`。
 */
export const readServiceRunning = (value: unknown): boolean | null => {
  if (!isRecord(value)) {
    return null
  }
  const state = value.state
  if (state === 'running' || state === 'starting' || state === 'stopping') {
    return true
  }
  if (state === 'stopped') {
    return false
  }
  const mode = value.mode
  if (mode === 'installed' || mode === 'running' || mode === 'starting' || mode === 'stopping') {
    return true
  }
  if (mode === 'stopped' || mode === 'uninitialized') {
    return false
  }
  return null
}

/** `backup.list` 返回的 dir 取不到时，用 ready 里的数据目录拼一个最接近的位置 */
export const fallbackBackupDir = (dataDir: string): string =>
  dataDir ? `${normalizePath(dataDir)}/backups` : ''
