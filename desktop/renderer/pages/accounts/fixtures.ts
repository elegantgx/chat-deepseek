import type { AccountList, AuthState } from '../../app/ipc-types'

/**
 * 账户页样本数据，字段与 `internal/ipc` 的 JSON 契约一致。
 * 接真后端时只替换数据来源，视图与交互不动。
 *
 * 列表刻意覆盖三种角色：当前登录的 Admin、Owner，以及普通成员；
 * 时间用本地时区的 RFC 3339，表格按账户的 createdAt 原样格式化。
 */
export const FIXTURE_AUTH: AuthState = {
  authenticated: true,
  username: 'gx',
  groups: ['User', 'Admin'],
  expiresAt: '2026-12-27T09:14:00+08:00',
}

export const FIXTURE_ACCOUNTS: AccountList = {
  accounts: [
    {
      id: 'acct-gx',
      username: 'gx',
      groups: ['User', 'Admin'],
      disabled: false,
      createdAt: '2026-11-02T09:14:00+08:00',
      self: true,
    },
    {
      id: 'acct-chen',
      username: 'chen',
      groups: ['User'],
      disabled: false,
      createdAt: '2026-11-20T14:30:00+08:00',
      self: false,
    },
    {
      id: 'acct-lin',
      username: 'lin',
      groups: ['User'],
      disabled: false,
      createdAt: '2026-11-25T20:07:00+08:00',
      self: false,
    },
    {
      id: 'acct-owner',
      username: 'owner',
      groups: ['User', 'Owner'],
      disabled: false,
      createdAt: '2026-11-26T18:40:00+08:00',
      self: false,
    },
  ],
}
