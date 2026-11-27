import type { ScreenRegistry } from '../registry.js'
import { LaunchScreen } from './launch/LaunchScreen.js'
import { ServerPickerScreen } from './server-picker/ServerPickerScreen.js'
import { ServerUninitScreen } from './server-uninit/ServerUninitScreen.js'
import { ServerPreparingScreen } from './server-preparing/ServerPreparingScreen.js'
import { ServerFailedScreen } from './server-failed/ServerFailedScreen.js'
import { ServerReadyScreen } from './server-ready/ServerReadyScreen.js'
import { ServerStoppedScreen } from './server-stopped/ServerStoppedScreen.js'
import { ServerLocalScreen } from './server-local/ServerLocalScreen.js'
import { ServerHostScreen } from './server-host/ServerHostScreen.js'

/**
 * 本机服务器组（01–05、08–10、26）的注册表导出，交给 `screens/registry.ts` 的
 * `screens` 汇总；屏 id 与 `SCREENS` 一一对应，不在这里另起名字。
 */
export const screens: Partial<ScreenRegistry> = {
  launch: LaunchScreen,
  'server-picker': ServerPickerScreen,
  'server-uninit': ServerUninitScreen,
  'server-preparing': ServerPreparingScreen,
  'server-failed': ServerFailedScreen,
  'server-ready': ServerReadyScreen,
  'server-stopped': ServerStoppedScreen,
  'server-local': ServerLocalScreen,
  'server-host': ServerHostScreen,
}
