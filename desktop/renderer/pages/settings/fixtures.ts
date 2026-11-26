import type { ConfigProjection, SystemStatus } from '../../app/ipc-types'

/**
 * 样本数据与 `internal/ipc` 的 JSON 同形：字段名是契约，接真后端时只换数据来源。
 * 路径统一写成用户可见的 `~/` 形式，避免在仓库里留下本机家目录。
 */
export const configFixture: ConfigProjection = {
  dataDir: '~/chat-deepseek/data',
  listen: '127.0.0.1:8091',
  apiOrigin: 'https://api.deepseek.com',
  backupDir: '~/chat-deepseek/data/backups',
  version: '0.1.4-official0.1.4',
}

export const systemStatusFixture: SystemStatus = {
  version: '0.1.4-official0.1.4',
  dataDir: '~/chat-deepseek/data',
  service: {
    state: 'running',
    listen: '127.0.0.1:8091',
    source: 'probe',
  },
}

/** 服务安装状态不在 SystemStatus 里；样本阶段单独给，卸载/重装时由页面本地状态模拟。 */
export const serviceFixture = {
  installed: true,
  unitPath: '~/.config/systemd/user/chat-deepseek.service',
} as const
