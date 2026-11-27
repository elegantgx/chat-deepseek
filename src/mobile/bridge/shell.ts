import type {
  ChatShell,
  ShellCapabilities,
  ShellReady,
  ShellServer,
  ShellServerKind,
} from './types.js'
import { createScenarioShell } from '../scenario/index.js'

/**
 * 取当前页面的 `ChatShell`。
 *
 * APK 里壳会注入 `window.ChatShell`；直接开浏览器预览时没有壳，
 * 就退回 `scenario/` 的 fake，并记下 `mock: true`。所有桥调用只认这里返回的实例，
 * 不各自去摸 `window`，否则真假两条路会越走越偏。
 */

export interface ShellRuntime {
  shell: ChatShell
  ready: ShellReady
  /** 数据来自 fake（浏览器预览 / 截图回归），仅用于调试与提示 */
  mock: boolean
}

let runtime: ShellRuntime | null = null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isServerKind = (value: unknown): value is ShellServerKind =>
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

const readCapabilities = (value: unknown): ShellCapabilities => {
  if (!isRecord(value) || !Array.isArray(value.methods)) {
    return { methods: [] }
  }
  const methods = value.methods.filter((method): method is string => typeof method === 'string')
  const features: Record<string, boolean> = {}
  if (isRecord(value.features)) {
    for (const [key, enabled] of Object.entries(value.features)) {
      if (typeof enabled === 'boolean') {
        features[key] = enabled
      }
    }
  }
  return {
    methods,
    ...(typeof value.ipcVersion === 'number' ? { ipcVersion: value.ipcVersion } : {}),
    ...(Object.keys(features).length > 0 ? { features } : {}),
  }
}

/** 校验并归一化 `ready()`；壳版本不匹配时宁可报错，也不带着半份上下文渲染 */
const parseReady = (raw: string): ShellReady => {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) {
    throw new Error('ready() 应该返回 JSON 对象')
  }
  const servers = Array.isArray(parsed.servers)
    ? parsed.servers.map(readServer).filter((server): server is ShellServer => server !== null)
    : []
  const selectedId =
    typeof parsed.selectedId === 'string' &&
    servers.some((server) => server.id === parsed.selectedId)
      ? parsed.selectedId
      : null
  return {
    version: typeof parsed.version === 'string' ? parsed.version : '',
    dataDir: typeof parsed.dataDir === 'string' ? parsed.dataDir : '',
    theme:
      parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
        ? parsed.theme
        : 'system',
    locale: parsed.locale === 'en-US' ? 'en-US' : 'zh-CN',
    capabilities: readCapabilities(parsed.capabilities),
    servers,
    selectedId,
  }
}

/**
 * 解析并缓存当前运行环境；`scenario` 只在浏览器预览（fake）时生效。
 * 重复调用返回同一份，fake 的内存状态不会因为组件重渲染被重置。
 */
export const resolveShell = (scenario?: string | null, locale?: string | null): ShellRuntime => {
  if (runtime) {
    return runtime
  }
  const injected = window.ChatShell
  if (injected) {
    let ready: ShellReady
    try {
      ready = parseReady(injected.ready())
    } catch (error) {
      throw new Error(
        `ChatShell.ready() 不合法：${error instanceof Error ? error.message : String(error)}`
      )
    }
    runtime = { shell: injected, ready, mock: false }
    return runtime
  }
  const shell = createScenarioShell(scenario, locale)
  runtime = { shell, ready: parseReady(shell.ready()), mock: true }
  return runtime
}

/** 已经初始化过就直接拿；没初始化说明入口没按顺序调用 resolveShell */
export const getShellRuntime = (): ShellRuntime => {
  if (!runtime) {
    throw new Error('桥还没初始化：mobile 入口必须先调用 resolveShell()')
  }
  return runtime
}
