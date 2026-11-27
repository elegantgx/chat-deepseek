import type { ScreenRegistry } from '../registry.js'
import { AppearanceDialogScreen } from './AppearanceDialogScreen.js'
import { DataApiKeyScreen } from './DataApiKeyScreen.js'
import { DataDeleteConfirmScreen } from './DataDeleteConfirmScreen.js'
import { DataImportConfirmScreen } from './DataImportConfirmScreen.js'
import { DataManageScreen } from './DataManageScreen.js'
import { FontSizeScreen } from './FontSizeScreen.js'
import { LanguageDialogScreen } from './LanguageDialogScreen.js'
import { ServerBackupDeleteConfirmScreen } from './ServerBackupDeleteConfirmScreen.js'
import { ServerBackupDetailScreen } from './ServerBackupDetailScreen.js'
import { ServerBackupRestoreConfirmScreen } from './ServerBackupRestoreConfirmScreen.js'
import { ServerBackupsScreen } from './ServerBackupsScreen.js'

/**
 * 数据组 11 屏的统一出口。
 *
 * 根 agent 只需要把 `dataScreens` merge 进 `screens/registry.ts` 的 `screens`：
 *   import { dataScreens } from './data/index.js'
 *   export const screens: Partial<ScreenRegistry> = { ...dataScreens }
 * 屏组件一律不接收 props，数据与导航分别从 runtime / navigation 的 Hook 取。
 */
export const dataScreens: Partial<ScreenRegistry> = {
  'server-backups': ServerBackupsScreen,
  'server-backup-detail': ServerBackupDetailScreen,
  'server-backup-restore-confirm': ServerBackupRestoreConfirmScreen,
  'server-backup-delete-confirm': ServerBackupDeleteConfirmScreen,
  'data-manage': DataManageScreen,
  'data-apikey': DataApiKeyScreen,
  'data-delete-confirm': DataDeleteConfirmScreen,
  'data-import-confirm': DataImportConfirmScreen,
  'font-size': FontSizeScreen,
  'appearance-dialog': AppearanceDialogScreen,
  'language-dialog': LanguageDialogScreen,
}

export {
  AppearanceDialogScreen,
  DataApiKeyScreen,
  DataDeleteConfirmScreen,
  DataImportConfirmScreen,
  DataManageScreen,
  FontSizeScreen,
  LanguageDialogScreen,
  ServerBackupDeleteConfirmScreen,
  ServerBackupDetailScreen,
  ServerBackupRestoreConfirmScreen,
  ServerBackupsScreen,
}
