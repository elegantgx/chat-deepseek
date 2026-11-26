/**
 * 备份页样本数据：字段与 `app/ipc-types.ts` 对齐，接真后端时只换来源。
 * 时间用带本地偏移的 RFC 3339，和 `backup.list` 的返回格式一致。
 */
import type { BackupEntry, BackupList, SystemStatus } from '../../app/ipc-types'

const BACKUP_DIR = '/srv/chat-deepseek/data/backups'

const entry = (file: string, size: number, mtime: string): BackupEntry => ({
  file,
  path: `${BACKUP_DIR}/${file}`,
  size,
  mtime,
})

/** 按时间从新到旧，和 `internal/backup.List` 的排序一致 */
const INITIAL_BACKUPS: BackupEntry[] = [
  entry('chat-deepseek-20261127-014421.zip', 50_540_544, '2026-11-27T01:44:21+08:00'),
  entry('chat-deepseek-20261126-021400.zip', 50_229_248, '2026-11-26T02:14:00+08:00'),
  entry('chat-deepseek-20261125-021400.zip', 49_388_390, '2026-11-25T02:14:00+08:00'),
  entry('chat-deepseek-20261124-021400.zip', 49_073_766, '2026-11-24T02:14:00+08:00'),
  entry('chat-deepseek-20261123-021400.zip', 48_758_784, '2026-11-23T02:14:00+08:00'),
]

/** `backup.list` 的样本结果：列表和目录一起更新，页面直接消费这个契约 */
export const INITIAL_BACKUP_LIST: BackupList = {
  backups: INITIAL_BACKUPS,
  dir: BACKUP_DIR,
}

const STOPPED_STATUS: SystemStatus = {
  version: '0.1.4-official0.1.4',
  dataDir: '/srv/chat-deepseek/data',
  service: {
    state: 'stopped',
    listen: '127.0.0.1:8091',
    source: 'probe',
  },
}

const RUNNING_STATUS: SystemStatus = {
  ...STOPPED_STATUS,
  service: {
    ...STOPPED_STATUS.service,
    state: 'running',
  },
}

export function serviceStatus(running: boolean): SystemStatus {
  return running ? RUNNING_STATUS : STOPPED_STATUS
}

/** 新建归档的样本大小，量级与已有备份保持一致 */
export const NEW_BACKUP_SIZE = 51_380_224

/** `backup.restore` 成功时实际恢复的数据条目（契约见 docs/ipc.md §4.6） */
export const RESTORED_ITEMS = ['config.json', 'chat.db', 'master.key', 'files/']

/**
 * IPC 错误样本。错误对象只有 code / message，界面统一格式化成 `{code}: {message}`；
 * `#backup-fail` 演示态会让创建 / 恢复 / 删除分别命中其中一条。
 */
export interface IpcFailureSample {
  code: string
  message: string
}

export const FAILURE_SAMPLES = {
  serviceRunning: {
    code: 'unavailable',
    message: '服务运行中，备份已暂停',
  },
  missing: {
    code: 'not_found',
    message: '备份不存在',
  },
  traversal: {
    code: 'bad_request',
    message: '备份文件名非法：不能包含路径分隔符',
  },
} satisfies Record<string, IpcFailureSample>
