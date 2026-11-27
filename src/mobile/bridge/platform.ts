import { callBridge } from './callbacks.js'
import { getShellRuntime } from './shell.js'
import type {
  KeepScreenOnParams,
  NotifyParams,
  OpenExternalParams,
  PermissionResult,
  PickFilesParams,
  PickFilesResult,
  PlatformMethod,
  RequestPermissionParams,
  ShareParams,
} from './types.js'

/**
 * 平台能力的薄封装：只负责拼参数、等 done、把错误抛给调用方。
 *
 * 这里不碰浏览器 API：文件选择、分享、权限、通知都由壳做；
 * 剪贴板与下载不走桥（§4.1），页面直接用 Web API。
 */
const platformCall = <T>(
  method: PlatformMethod,
  params: unknown,
  signal?: AbortSignal
): Promise<T> => {
  const runtime = getShellRuntime()
  return callBridge<T>((id) => runtime.shell.platform(id, method, JSON.stringify(params ?? {})), {
    ...(signal ? { signal } : {}),
    abort: (id) => runtime.shell.abort(id),
  })
}

export const pickFiles = (
  params: PickFilesParams = {},
  signal?: AbortSignal
): Promise<PickFilesResult> => platformCall<PickFilesResult>('pickFiles', params, signal)

export const share = async (params: ShareParams, signal?: AbortSignal): Promise<void> => {
  await platformCall<unknown>('share', params, signal)
}

export const openExternal = async (
  params: OpenExternalParams,
  signal?: AbortSignal
): Promise<void> => {
  await platformCall<unknown>('openExternal', params, signal)
}

export const requestPermission = (
  params: RequestPermissionParams,
  signal?: AbortSignal
): Promise<PermissionResult> => platformCall<PermissionResult>('requestPermission', params, signal)

export const notify = async (params: NotifyParams, signal?: AbortSignal): Promise<void> => {
  await platformCall<unknown>('notify', params, signal)
}

export const setKeepScreenOn = async (
  params: KeepScreenOnParams,
  signal?: AbortSignal
): Promise<void> => {
  await platformCall<unknown>('setKeepScreenOn', params, signal)
}
