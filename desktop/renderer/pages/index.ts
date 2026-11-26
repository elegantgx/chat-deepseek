import type { ComponentType } from 'react'
import type { PageId } from '../app/nav'
import { AccountsPage } from './accounts'
import { BackupPage } from './backup'
import { ServicePage } from './service'
import { SettingsPage } from './settings'

/** 页面注册表：key 必须与 nav 的 PageId 一致，缺一个类型就报错 */
export const PAGES: Record<PageId, ComponentType> = {
  service: ServicePage,
  accounts: AccountsPage,
  backup: BackupPage,
  settings: SettingsPage,
}
