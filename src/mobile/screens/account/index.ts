import type { ScreenRegistry } from '../registry.js'
import { AccountCreateErrorScreen, AccountCreateScreen } from './AccountCreateScreen.js'
import { AccountManageScreen } from './AccountManageScreen.js'
import { AccountPasswordScreen } from './AccountPasswordScreen.js'
import { AccountUsernameScreen } from './AccountUsernameScreen.js'
import { ServerAccountsAddScreen } from './ServerAccountsAddScreen.js'
import { ServerAccountsScreen } from './ServerAccountsScreen.js'
import { SettingsScreen } from './SettingsScreen.js'

/**
 * 「账户 + 设置」8 屏的出口。
 *
 * 屏组件不接收 props，注册表只需要把 id 映射到组件；`accountScreens` 与其它屏组
 * 同名同形（`Partial<ScreenRegistry>`），根 agent 直接 merge 即可。
 * `account-create` 与 `account-create-error` 共用同一张表单，后者只带首帧错误种子。
 */
export const accountScreens: Partial<ScreenRegistry> = {
  'account-create': AccountCreateScreen,
  'account-create-error': AccountCreateErrorScreen,
  settings: SettingsScreen,
  'server-accounts': ServerAccountsScreen,
  'server-accounts-add': ServerAccountsAddScreen,
  'account-manage': AccountManageScreen,
  'account-username': AccountUsernameScreen,
  'account-password': AccountPasswordScreen,
}

export {
  AccountCreateErrorScreen,
  AccountCreateScreen,
  AccountManageScreen,
  AccountPasswordScreen,
  AccountUsernameScreen,
  ServerAccountsAddScreen,
  ServerAccountsScreen,
  SettingsScreen,
}
