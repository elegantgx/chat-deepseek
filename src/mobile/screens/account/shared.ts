import { useEffect, useState } from 'react'
import { normalizeHostError } from '../../bridge/host.js'
import type { HostClient } from '../../bridge/host.js'
import { ApiError } from '../../../services/api/client.js'
import { getMe, type AuthUser } from '../../../services/api/server.js'
import { loadSettings } from '../../../services/settings.js'

/**
 * 账户 8 屏共用的数据访问与判定。
 *
 * 两条通道刻意分开：
 * - 本机账户（Owner/成员/管理员）走 ipc `account.*`，只在 `host` 上调用；
 * - 登录账户（用户名/密码/头像）走 `/api/v1/auth/*`，只经 `src/services` 的 fetch。
 * 这里不做「统一账户 store」：两边登录态本来就可能不同步（本机会话过期但聊天仍在，
 * 或远程只登录了 HTTP），合并后会互相覆盖。
 */

/** 与 ipc `account.add` / `auth.setup` 的校验一致；本地先判能给即时红圈 */
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
export const MIN_PASSWORD_LENGTH = 8

export interface HostAccount {
  id: string
  username: string
  groups: string[]
  disabled: boolean
  createdAt: string
  self: boolean
}

export type RoleKey = 'roleOwner' | 'roleAdmin' | 'roleMember'

export const roleOf = (groups: readonly string[]): RoleKey => {
  if (groups.includes('Owner')) {
    return 'roleOwner'
  }
  if (groups.includes('Admin')) {
    return 'roleAdmin'
  }
  return 'roleMember'
}

/** RFC 3339 只取日期；示意里副标题就是 `2026-11-02 创建` */
export const formatCreatedAt = (value: string): string => {
  const matched = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return matched?.[1] ?? value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readAccount = (value: unknown): HostAccount | null => {
  if (!isRecord(value)) {
    return null
  }
  const { id, username, groups, disabled, createdAt, self } = value
  if (
    typeof id !== 'string' ||
    typeof username !== 'string' ||
    !Array.isArray(groups) ||
    typeof disabled !== 'boolean' ||
    typeof createdAt !== 'string' ||
    typeof self !== 'boolean'
  ) {
    return null
  }
  return {
    id,
    username,
    groups: groups.filter((group): group is string => typeof group === 'string'),
    disabled,
    createdAt,
    self,
  }
}

/**
 * 读本机账户列表。形状不对时抛错而不是给空数组：
 * 空数组在页面上等于「还没有账户」，会把契约错误伪装成正常空态。
 */
export const fetchHostAccounts = async (host: HostClient): Promise<HostAccount[]> => {
  const result = await host.request('account.list')
  if (!isRecord(result) || !Array.isArray(result.accounts)) {
    throw new Error('account.list 返回形状不对')
  }
  return result.accounts
    .map(readAccount)
    .filter((account): account is HostAccount => account !== null)
}

/** ipc 错误里只有 `unauthenticated` 表示要重新登录；其它错误给重试 */
export const hostErrorCode = (error: unknown): string => normalizeHostError(error).code

export const isHostUnauthenticated = (error: unknown): boolean =>
  hostErrorCode(error) === 'unauthenticated'

/** HTTP 状态码；网络错误没有状态码，返回 null */
export const apiStatus = (error: unknown): number | null =>
  error instanceof ApiError && typeof error.status === 'number' ? error.status : null

/**
 * HTTP 账户改动成功后刷新一次服务端设置。
 * 用户名/密码/登录态变化会影响后续请求的归属，设置也以服务端为准；
 * 失败不阻塞「已保存」的反馈，下一次进入设置还会重新拉。
 */
export const refreshAfterAccountChange = async (): Promise<void> => {
  await Promise.all([getMe().catch(() => null), loadSettings().catch(() => undefined)])
}

export type HttpUserState = 'loading' | 'ready' | 'expired' | 'failed'

/**
 * 读取当前 HTTP 登录账户；`getMe()` 自己把 401 折成 null，
 * 所以这里把 null 解释为「会话过期」，网络异常才是「读取失败」。
 */
export const useHttpUser = (): {
  user: AuthUser | null
  state: HttpUserState
  setUser: (user: AuthUser) => void
  reload: () => void
} => {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [state, setState] = useState<HttpUserState>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState('loading')
    getMe()
      .then((session) => {
        if (!active) {
          return
        }
        if (session) {
          setUser(session.user)
          setState('ready')
        } else {
          setUser(null)
          setState('expired')
        }
      })
      .catch(() => {
        if (active) {
          setState('failed')
        }
      })
    return () => {
      active = false
    }
  }, [attempt])

  return {
    user,
    state,
    setUser,
    reload: () => setAttempt((value) => value + 1),
  }
}

/** 头像失败原因只用于 toast；服务端 400/413 与工具函数自己的报错都归一 */
export const avatarErrorKind = (error: unknown): 'tooLarge' | 'invalid' | 'failed' => {
  if (error instanceof Error && error.message === 'avatar too large') {
    return 'tooLarge'
  }
  if (error instanceof Error && error.message === 'not an image') {
    return 'invalid'
  }
  const status = apiStatus(error)
  if (status === 413) {
    return 'tooLarge'
  }
  if (status === 400) {
    return 'invalid'
  }
  return 'failed'
}
