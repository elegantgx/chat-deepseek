import { useCallback, useEffect, useRef, useState } from 'react'
import { useHost } from '../../../app/runtime.js'
import { normalizeHostError } from '../../../bridge/host.js'
import type { HostClient, HostError } from '../../../bridge/host.js'

/**
 * 本机服务器组共用的数据源。
 *
 * 三件事必须都由这里统一做，避免九屏各写一遍后行为漂移：
 * - 服务状态只认 `service.status`（端口也从它的 `listen` 取，不写死 8091）；
 * - 订阅 `event.service.*` 后重新拉状态：ipc v1 只投影日志事件，没有独立的状态事件，
 *   所以任意服务事件都当作“端口可能变了”的信号，去重后静默刷新；
 * - 初始化状态来自 `auth.whoami`（它是唯一回答“数据目录有没有活动 Owner”的方法），
 *   账户/备份数量只在本机维护组里需要，读失败就显示读取中，不阻塞主状态。
 */

export interface ServiceStatusResult {
  state: 'running' | 'stopped' | 'unknown'
  listen: string
  source?: string
  mode?: string
  installed?: boolean
  supported?: boolean
  linger?: boolean
}

export interface ConfigProjection {
  dataDir: string
  listen: string
  apiOrigin: string
  backupDir: string
  version: string
}

export interface AuthState {
  authenticated: boolean
  initialized: boolean
  username?: string
  groups?: string[]
}

export type AccountRole = 'owner' | 'admin' | 'member'

interface AccountListResult {
  accounts: Array<{ groups?: string[]; self?: boolean }>
}

interface BackupListResult {
  backups: unknown[]
}

export interface LocalServerData {
  status: ServiceStatusResult | null
  config: ConfigProjection | null
  auth: AuthState | null
  role: AccountRole | null
  accountTotal: number | null
  backupCount: number | null
  error: HostError | null
  /** 只有首轮读取为 true；后续静默刷新不闪 loading */
  loading: boolean
  refresh: () => Promise<void>
}

export interface LocalServerOptions {
  /** 本机维护组需要账户/备份数量；其它屏不读，省两次 ipc 往返 */
  maintenance?: boolean
}

const readStatus = async (host: HostClient): Promise<ServiceStatusResult> =>
  (await host.request('service.status')) as ServiceStatusResult

const roleOf = (groups: string[] | undefined): AccountRole | null => {
  if (!groups || groups.length === 0) {
    return null
  }
  if (groups.includes('Owner')) {
    return 'owner'
  }
  if (groups.includes('Admin')) {
    return 'admin'
  }
  return 'member'
}

export const useLocalServer = ({
  maintenance = false,
}: LocalServerOptions = {}): LocalServerData => {
  const host = useHost()
  const [status, setStatus] = useState<ServiceStatusResult | null>(null)
  const [config, setConfig] = useState<ConfigProjection | null>(null)
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [role, setRole] = useState<AccountRole | null>(null)
  const [accountTotal, setAccountTotal] = useState<number | null>(null)
  const [backupCount, setBackupCount] = useState<number | null>(null)
  const [error, setError] = useState<HostError | null>(null)
  const [loading, setLoading] = useState(true)
  /** 卸载后异步结果不再落状态；也防止事件刷新在切屏后继续跑 */
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const next = await readStatus(host)
      if (aliveRef.current) {
        setStatus(next)
        setError(null)
      }
    } catch (failure) {
      if (aliveRef.current) {
        setError(normalizeHostError(failure))
      }
    }
  }, [host])

  const refresh = useCallback(async () => {
    const [statusResult, configResult, authResult] = await Promise.allSettled([
      readStatus(host),
      host.request('config.get'),
      host.request('auth.whoami'),
    ])
    if (!aliveRef.current) {
      return
    }

    if (statusResult.status === 'fulfilled') {
      setStatus(statusResult.value)
      setError(null)
    } else {
      setError(normalizeHostError(statusResult.reason))
    }
    if (configResult.status === 'fulfilled') {
      setConfig(configResult.value as ConfigProjection)
    }

    let nextAuth: AuthState | null = null
    if (authResult.status === 'fulfilled') {
      nextAuth = authResult.value as AuthState
      setAuth(nextAuth)
      setRole(roleOf(nextAuth.groups))
    }

    if (maintenance) {
      const [accountsResult, backupsResult] = await Promise.allSettled([
        host.request('account.list'),
        host.request('backup.list'),
      ])
      if (!aliveRef.current) {
        return
      }
      if (accountsResult.status === 'fulfilled') {
        const list = accountsResult.value as AccountListResult
        setAccountTotal(list.accounts.length)
        // 登录态没回来时用带 self 的账户行兜底判断角色；找不到自己就不要猜
        if (nextAuth === null) {
          const self = list.accounts.find((account) => account.self)
          setRole(self ? roleOf(self.groups) : null)
        }
      }
      if (backupsResult.status === 'fulfilled') {
        setBackupCount((backupsResult.value as BackupListResult).backups.length)
      }
    }

    setLoading(false)
  }, [host, maintenance])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = host.onEvent((method) => {
      if (!method.startsWith('event.service.')) {
        return
      }
      // 启动时会有多条日志事件连发；合并成一次状态刷新，避免打满 ipc
      if (timer !== null) {
        return
      }
      timer = setTimeout(() => {
        timer = null
        void refreshStatus()
      }, 120)
    })
    return () => {
      unsubscribe()
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [host, refreshStatus])

  return {
    status,
    config,
    auth,
    role,
    accountTotal,
    backupCount,
    error,
    loading,
    refresh,
  }
}

/**
 * `service.start/restart` 返回 `starting` 时端口还没就绪；按桌面端同一套做法轮询到
 * running/stopped。超时返回 null，调用方把事件流当作后续补偿，不把按钮永远挂着。
 */
export const waitForServiceSettle = async (
  host: HostClient,
  timeoutMs = 8000
): Promise<ServiceStatusResult | null> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    try {
      const next = await readStatus(host)
      if (next.state === 'running' || next.state === 'stopped') {
        return next
      }
    } catch {
      return null
    }
  }
  return null
}
