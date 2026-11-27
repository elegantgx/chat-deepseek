import type { ScreenRegistry } from '../registry.js'
import { RemoteAddScreen } from './RemoteAddScreen.js'
import { RemoteDetailScreen } from './RemoteDetailScreen.js'
import { RemoteLoginScreen } from './RemoteLoginScreen.js'

/**
 * 远程服务器组的注册表片段。
 *
 * 状态屏复用同一个组件：组件从路由 id 取首帧状态，用户操作后就在同一实例里流转，
 * 不把「失败/离线」做成独立页面，和 visual §7.1 的约定一致。
 */
export const screens: Partial<ScreenRegistry> = {
  'server-remote-add': RemoteAddScreen,
  'server-remote-add-failed': RemoteAddScreen,
  'server-remote-login': RemoteLoginScreen,
  'server-remote-login-error': RemoteLoginScreen,
  'server-remote-detail': RemoteDetailScreen,
  'server-remote-detail-offline': RemoteDetailScreen,
}
