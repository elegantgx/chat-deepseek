import type { ComponentType } from 'react'
import { ArchiveIcon, ServerIcon, SlidersIcon, UsersIcon } from '../ui'
import type { IconProps } from '../ui'

/** 四个管理页面的稳定标识；同时用作 hash 路由与页面注册表的 key */
export type PageId = 'service' | 'accounts' | 'backup' | 'settings'

export interface NavEntry {
  id: PageId
  label: string
  Icon: ComponentType<IconProps>
}

/** 侧栏顺序即产品里的顺序，不要按字母排 */
export const NAV: readonly NavEntry[] = [
  { id: 'service', label: '服务', Icon: ServerIcon },
  { id: 'accounts', label: '账户', Icon: UsersIcon },
  { id: 'backup', label: '备份', Icon: ArchiveIcon },
  { id: 'settings', label: '设置', Icon: SlidersIcon },
]

const PAGE_IDS = new Set<string>(NAV.map((entry) => entry.id))

export const DEFAULT_PAGE: PageId = 'service'

export function isPageId(value: string): value is PageId {
  return PAGE_IDS.has(value)
}
