/**
 * 桌面端设计系统入口：组件 + token + 全局基线。
 * 页面从 '../ui' 引入即可同时拿到 --* 变量与 reset，不需要再单独引 CSS。
 */
import './tokens.css'
import './global.css'

export { Badge } from './Badge'
export type { BadgeProps } from './Badge'

export { Button } from './Button'
export type { ButtonProps, ButtonSize, ButtonTone } from './Button'

export { Card, CardFooter, CardHeader } from './Card'
export type { CardFooterProps, CardHeaderProps, CardProps } from './Card'

export { Dialog } from './Dialog'
export type { DialogProps } from './Dialog'

export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { Field } from './Field'
export type { FieldProps, FieldType } from './Field'

export { LogPane } from './LogPane'
export type { LogLevel, LogLine, LogPaneFooterAction, LogPaneProps } from './LogPane'

export { Paper } from './Paper'
export type { PaperProps } from './Paper'

export { Segmented } from './Segmented'
export type { SegmentedOption, SegmentedProps } from './Segmented'

export { Sidebar, SidebarBrand, SidebarItem } from './Sidebar'
export type { SidebarBrandProps, SidebarItemProps, SidebarProps } from './Sidebar'

export { StatusPill } from './StatusPill'
export type { StatusKind, StatusPillProps } from './StatusPill'

export { Table } from './Table'
export type { TableColumn, TableProps, TableRowActions } from './Table'

export { TextButton } from './TextButton'
export type { TextButtonProps, TextButtonTone } from './TextButton'

export { Toast } from './Toast'
export type { ToastProps, ToastTone } from './Toast'

export { Toggle } from './Toggle'
export type { ToggleProps } from './Toggle'

/* 图标随设计系统一起发：24 网格 / 1.5 描边 / round cap */
export {
  AlertTriangleIcon,
  ArchiveIcon,
  ChatIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  DownloadIcon,
  InboxIcon,
  PlusIcon,
  PowerIcon,
  RefreshIcon,
  ServerIcon,
  SlidersIcon,
  UsersIcon,
  XCircleIcon,
} from './icons'
export type { IconProps } from './icons'
