import { useCallback, useEffect, useState } from 'react'
import type { HostClient } from '../../bridge/host.js'
import { normalizeHostError } from '../../bridge/host.js'
import type { ShellServer } from '../../bridge/types.js'
import { useHost, useReady } from '../../app/runtime.js'

/**
 * 远程服务器屏共用的数据与动作。
 *
 * 列表有两个来源（`ready()` 的启动快照 + `shell.servers.list` 的实时投影）：
 * 前者保证桥还没答话时页面不是空的，后者负责增删之后的刷新。浏览器 fake 目前没有
 * `shell.servers.*`，请求会失败——失败时保留 `ready()` 快照，不把列表清空。
 */

export interface RemoteServerState {
  servers: ShellServer[]
  selectedId: string | null
  reload: () => Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const isServerKind = (value: unknown): value is ShellServer['kind'] =>
  value === 'local' || value === 'remote'

const isServerMode = (value: unknown): value is ShellServer['mode'] =>
  value === 'installed' || value === 'uninitialized' || value === 'stopped'

const readServer = (value: unknown): ShellServer | null => {
  if (!isRecord(value)) {
    return null
  }
  const { id, kind, name, mode, baseUrl } = value
  if (
    typeof id !== 'string' ||
    !isServerKind(kind) ||
    typeof name !== 'string' ||
    !isServerMode(mode) ||
    typeof baseUrl !== 'string'
  ) {
    return null
  }
  return { id, kind, name, mode, baseUrl }
}

interface ServersPayload {
  servers: ShellServer[]
  selectedId: string | null
}

/** `shell.servers.list` 的结果：壳返回 `{servers, selectedId}`，坏数据整份丢弃 */
const readServersPayload = (value: unknown): ServersPayload | null => {
  if (!isRecord(value) || !Array.isArray(value.servers)) {
    return null
  }
  const servers = value.servers
    .map(readServer)
    .filter((server): server is ShellServer => server !== null)
  return {
    servers,
    selectedId: readString(value.selectedId),
  }
}

export const useRemoteServers = (): RemoteServerState => {
  const ready = useReady()
  const host = useHost()
  const [servers, setServers] = useState<ShellServer[]>(ready.servers)
  const [selectedId, setSelectedId] = useState<string | null>(ready.selectedId)

  const reload = useCallback(async () => {
    try {
      const payload = readServersPayload(await host.request('shell.servers.list'))
      if (!payload) {
        return
      }
      setServers(payload.servers)
      setSelectedId(payload.selectedId)
    } catch {
      // 旧壳或浏览器 fake 没有这个壳方法；保留启动快照即可，不做降级提示。
    }
  }, [host])

  useEffect(() => {
    void reload()
  }, [reload])

  return { servers, selectedId, reload }
}

export const remoteServersOf = (servers: ShellServer[]): ShellServer[] =>
  servers.filter((server) => server.kind === 'remote')

/** 地址规范化：去首尾空白与尾部斜杠，与壳的 `normalizeRemoteUrl` 保持一致 */
export const normalizeRemoteAddress = (raw: string): string => raw.trim().replace(/\/+$/, '')

export type AddressValidation = 'ok' | 'https' | 'invalid'

/**
 * 加入前先做和壳同口径的预检：只收 https、必须是绝对地址、不能带凭据/查询/片段。
 * 壳仍会再校验一次；这里做是为了在按下按钮时就能指出问题，而不是等一个错误码。
 */
export const validateRemoteAddress = (baseUrl: string): AddressValidation => {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return 'invalid'
  }
  if (url.protocol !== 'https:') {
    return 'https'
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    return 'invalid'
  }
  return 'ok'
}

/** 从地址里取主机名；服务器 chip 只显示 host，不带协议和路径（示意如此） */
export const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '')
  }
}

export type ProbeFailure = 'tls' | 'network' | 'http' | 'protocol' | 'unknown'

export type ProbeOutcome =
  | { ok: true; baseUrl: string; version: string }
  | { ok: false; failure: ProbeFailure; status?: number }

/**
 * 探测一台还没加入列表的服务器。
 *
 * `tls` 必须单独返回：证书不受信任和「连不上」的下一步不同（换地址/换证书 vs 检查网络），
 * 产品明确不做「忽略证书继续」。其余错误码保留壳的原样分类，页面据此显示不同文案。
 */
export const probeRemote = async (host: HostClient, baseUrl: string): Promise<ProbeOutcome> => {
  try {
    const value = await host.request('shell.servers.probe', { baseUrl })
    if (!isRecord(value)) {
      return { ok: false, failure: 'protocol' }
    }
    return {
      ok: true,
      baseUrl: readString(value.baseUrl) ?? baseUrl,
      version: readString(value.version) ?? '',
    }
  } catch (error) {
    const normalized = normalizeHostError(error)
    switch (normalized.code) {
      case 'tls':
        return { ok: false, failure: 'tls' }
      case 'network':
        return { ok: false, failure: 'network' }
      case 'http':
        return {
          ok: false,
          failure: 'http',
          ...(typeof normalized.status === 'number' ? { status: normalized.status } : {}),
        }
      case 'protocol':
        return { ok: false, failure: 'protocol' }
      default:
        // not_found（fake 没有壳方法）、unsupported、internal 都当普通失败，
        // 不让页面把「预览环境没实现」误报成证书问题。
        return { ok: false, failure: 'unknown' }
    }
  }
}

/** `shell.servers.add` 返回 `{server}`；重复 baseUrl 时壳返回已有的那台，不会新建 */
export const addRemoteServer = async (
  host: HostClient,
  baseUrl: string
): Promise<ShellServer | null> => {
  const value = await host.request('shell.servers.add', { baseUrl })
  if (!isRecord(value)) {
    return null
  }
  return readServer(value.server)
}

/**
 * 持久化服务器选择。成功返回 true。
 *
 * 失败不抛给调用方：登录已经成功时选择失败不该把用户留在登录页（数据面已经打到
 * 正确的服务器上了）；调用方只需要知道要不要继续导航。
 */
export const selectRemoteServer = async (host: HostClient, id: string): Promise<boolean> => {
  try {
    await host.request('shell.servers.select', { id })
    return true
  } catch {
    return false
  }
}
