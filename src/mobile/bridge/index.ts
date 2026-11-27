/**
 * mobile 桥的公开入口。
 *
 * 页面通常只需要 `host` 的 Hook + `installBridge`；`fetch`/`platform` 在需要时再直接引，
 * 集中 re-export 是为了后续 36 屏 agent 只记一个路径。
 */
export { callBridge, AbortedError, installBridgeCallbacks } from './callbacks.js'
export { bridgeFetch, setFallbackFetch } from './fetch.js'
export { createHostClient, normalizeHostError } from './host.js'
export type { HostClient, HostError } from './host.js'
export { installBridge } from './install.js'
export {
  notify,
  openExternal,
  pickFiles,
  requestPermission,
  setKeepScreenOn,
  share,
} from './platform.js'
export { getShellRuntime, resolveShell } from './shell.js'
export type { ShellRuntime } from './shell.js'
export * from './types.js'
