import type { ComponentType } from 'react'
import type { TranslationKey } from '../../i18n/types.js'
import { screens as remoteScreens } from './remote/index.js'
import { accountScreens } from './account/index.js'
import { chatScreens } from './chat/index.js'
import { screens as localScreens } from './local/index.js'
import { dataScreens } from './data/index.js'

/**
 * 36 屏的唯一注册表。
 *
 * - `SCREENS` 的顺序、编号、文件名与 `docs/android-visual.md` §7 一一对应，`id` 直接用
 *   示意里的文件名（`?screen=server-stopped` 也用它）；
 * - `screens` 现在是空实现，未注册的屏由 `router.tsx` 渲染占位；
 * - 后续 36 屏 agent 在下面补组件即可，不要改 `ScreenId` 或编号：
 *
 *   import { LaunchScreen } from './launch/LaunchScreen.js'
 *   ...
 *   export const screens: Partial<ScreenRegistry> = {
 *     launch: LaunchScreen,
 *     'server-picker': ServerPickerScreen,
 *   }
 *
 *   屏组件不接收 props：数据从 `app/runtime.js` 的 Hook 取，导航从 `app/navigation.js` 取
 *   （不要 import `app/router.tsx`，否则 registry → 屏 → router → registry 成环）。
 */
export interface ScreenMeta {
  id: string
  /** 文档里的两位编号；`?screen=01` 与 `?screen=launch` 等价 */
  number: number
  titleKey: TranslationKey
}

export const SCREENS = [
  { id: 'launch', number: 1, titleKey: 'mobileScreenLaunch' },
  { id: 'server-picker', number: 2, titleKey: 'mobileScreenServerPicker' },
  { id: 'server-uninit', number: 3, titleKey: 'mobileScreenServerUninit' },
  { id: 'server-preparing', number: 4, titleKey: 'mobileScreenServerPreparing' },
  { id: 'server-failed', number: 5, titleKey: 'mobileScreenServerFailed' },
  { id: 'account-create', number: 6, titleKey: 'mobileScreenAccountCreate' },
  { id: 'account-create-error', number: 7, titleKey: 'mobileScreenAccountCreateError' },
  { id: 'server-ready', number: 8, titleKey: 'mobileScreenServerReady' },
  { id: 'server-stopped', number: 9, titleKey: 'mobileScreenServerStopped' },
  { id: 'server-local', number: 10, titleKey: 'mobileScreenServerLocal' },
  { id: 'chat-welcome', number: 11, titleKey: 'mobileScreenChatWelcome' },
  { id: 'chat-drawer', number: 12, titleKey: 'mobileScreenChatDrawer' },
  { id: 'settings', number: 13, titleKey: 'mobileScreenSettings' },
  { id: 'server-remote-add', number: 14, titleKey: 'mobileScreenServerRemoteAdd' },
  { id: 'server-remote-add-failed', number: 15, titleKey: 'mobileScreenServerRemoteAddFailed' },
  { id: 'server-remote-login', number: 16, titleKey: 'mobileScreenServerRemoteLogin' },
  {
    id: 'server-remote-login-error',
    number: 17,
    titleKey: 'mobileScreenServerRemoteLoginError',
  },
  { id: 'server-remote-detail', number: 18, titleKey: 'mobileScreenServerRemoteDetail' },
  {
    id: 'server-remote-detail-offline',
    number: 19,
    titleKey: 'mobileScreenServerRemoteDetailOffline',
  },
  { id: 'server-accounts', number: 20, titleKey: 'mobileScreenServerAccounts' },
  { id: 'server-accounts-add', number: 21, titleKey: 'mobileScreenServerAccountsAdd' },
  { id: 'server-backups', number: 22, titleKey: 'mobileScreenServerBackups' },
  { id: 'server-backup-detail', number: 23, titleKey: 'mobileScreenServerBackupDetail' },
  {
    id: 'server-backup-restore-confirm',
    number: 24,
    titleKey: 'mobileScreenServerBackupRestoreConfirm',
  },
  {
    id: 'server-backup-delete-confirm',
    number: 25,
    titleKey: 'mobileScreenServerBackupDeleteConfirm',
  },
  { id: 'server-host', number: 26, titleKey: 'mobileScreenServerHost' },
  { id: 'account-manage', number: 27, titleKey: 'mobileScreenAccountManage' },
  { id: 'account-username', number: 28, titleKey: 'mobileScreenAccountUsername' },
  { id: 'account-password', number: 29, titleKey: 'mobileScreenAccountPassword' },
  { id: 'data-manage', number: 30, titleKey: 'mobileScreenDataManage' },
  { id: 'data-apikey', number: 31, titleKey: 'mobileScreenDataApikey' },
  { id: 'data-delete-confirm', number: 32, titleKey: 'mobileScreenDataDeleteConfirm' },
  { id: 'data-import-confirm', number: 33, titleKey: 'mobileScreenDataImportConfirm' },
  { id: 'font-size', number: 34, titleKey: 'mobileScreenFontSize' },
  { id: 'appearance-dialog', number: 35, titleKey: 'mobileScreenAppearanceDialog' },
  { id: 'language-dialog', number: 36, titleKey: 'mobileScreenLanguageDialog' },
] as const satisfies readonly ScreenMeta[]

export type ScreenId = (typeof SCREENS)[number]['id']

export type ScreenRegistry = Record<ScreenId, ComponentType>

/**
 * 各组在 `screens/<group>/index.ts` 里导出自己的片段，这里只做合并。
 * 故意用 Partial：骨架阶段只有类型和占位，缺屏不是构建错误；缺的屏由路由画占位。
 */
export const screens: Partial<ScreenRegistry> = {
  ...remoteScreens,
  ...accountScreens,
  ...chatScreens,
  ...localScreens,
  ...dataScreens,
}

/** `?screen=` 既接受 `server-stopped`，也接受 `9` / `09`；未知值返回 null 交给默认路由 */
export const resolveScreenParam = (value: string | null | undefined): ScreenId | null => {
  if (!value) {
    return null
  }
  const byId = SCREENS.find((screen) => screen.id === value)
  if (byId) {
    return byId.id
  }
  if (!/^\d{1,2}$/.test(value)) {
    return null
  }
  const byNumber = SCREENS.find((screen) => screen.number === Number(value))
  return byNumber ? byNumber.id : null
}

/** 取屏的元信息；ScreenId 一定能在表里找到，但保留 undefined 让调用方处理异常输入 */
export const screenMeta = (id: ScreenId): ScreenMeta | undefined =>
  SCREENS.find((screen) => screen.id === id)
