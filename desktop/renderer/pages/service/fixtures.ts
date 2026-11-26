/**
 * 服务页样本数据：字段与 `app/ipc-types.ts` 对齐，接真后端时只换来源。
 * 日志行先用 `时间 级别 消息` 的文本形态，页面再解析成 `LogPane` 需要的结构；
 * 真实 journal 行前缀更杂，下一波接入时在解析层适配，视图不用动。
 */
import type {
  ServiceLogEvent,
  ServiceLogsResult,
  ServiceStartResult,
  SystemStatus,
} from '../../app/ipc-types'

const STOPPED_STATUS: SystemStatus = {
  version: '0.1.4-official0.1.4',
  dataDir: '~/chat-deepseek/data',
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

/** `service.*` 底层是 systemd 用户级实现，见 docs/ipc.md §9；样本阶段直接展示这句话 */
export const SERVICE_START_MODE = 'systemd 用户级'

/** 启动成功后服务会打印监听地址；样本里让启动结果和日志共用同一个地址 */
export const SERVICE_START_RESULT: ServiceStartResult = {
  state: 'running',
  pid: 48213,
  listen: '127.0.0.1:8091',
}

/** 最近 15 行：覆盖启动、登录、会话保存、备份跳过和一次恢复失败 */
export const SERVICE_LOGS_RESULT: ServiceLogsResult = {
  lines: [
    '22:14:03 INFO serve listening on 127.0.0.1:8091',
    '22:14:03 INFO database opened: data/chat.db (journal=wal)',
    '22:14:04 INFO webui embedded build 0.1.4-official0.1.4',
    '22:14:11 INFO login ok user=gx ip=127.0.0.1',
    '22:14:12 INFO session 9f3c…31 created (branch main)',
    '22:15:02 INFO settings updated: theme=system lang=zh',
    '22:15:40 INFO session 9f3c…31 saved version=42 (18ms)',
    '22:15:41 INFO stream proxy deepseek-chat 128 tok/s',
    '22:16:02 WARN backup skipped: wal file present',
    '22:16:33 ERROR restore failed: service is running',
    '22:16:41 INFO GET /api/service 200 (3ms)',
    '22:16:44 INFO GET /api/sessions 200 (7ms)',
    '22:16:52 INFO POST /api/chat/stream 200 (1.2s)',
    '22:16:59 INFO session 9f3c…31 saved version=43 (12ms)',
    '22:17:04 INFO attachment stored: 7f2a…c9 (42.1 KB)',
  ],
  truncated: false,
}

/** 启停成功后追加的 `event.service.log` 样本；页面自己补时间戳 */
export const SERVICE_START_EVENTS: readonly ServiceLogEvent[] = [
  { line: 'INFO starting chat-deepseek.service', stream: 'stdout' },
  { line: `INFO serve listening on ${SERVICE_START_RESULT.listen}`, stream: 'stdout' },
  { line: 'INFO database opened: data/chat.db (journal=wal)', stream: 'stdout' },
]

export const SERVICE_STOP_EVENTS: readonly ServiceLogEvent[] = [
  { line: 'INFO stopping chat-deepseek.service', stream: 'stdout' },
  { line: 'INFO service stopped: chat-deepseek.service', stream: 'stdout' },
  { line: 'INFO journal follow closed', stream: 'stdout' },
]

export const SERVICE_RESTART_EVENTS: readonly ServiceLogEvent[] = [
  { line: 'INFO restarting chat-deepseek.service', stream: 'stdout' },
  { line: `INFO serve listening on ${SERVICE_START_RESULT.listen}`, stream: 'stdout' },
  { line: 'INFO webui embedded build 0.1.4-official0.1.4', stream: 'stdout' },
]
