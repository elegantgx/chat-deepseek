import { useEffect, type ReactNode } from 'react'
import brandUrl from '../assets/brand.svg'
import { BrandMark, Paper, Sidebar, SidebarBrand, SidebarItem } from '../ui'
import { NAV } from './nav'
import type { PageId } from './nav'
import styles from './frame.module.css'

/**
 * 应用外壳：左侧 240 玻璃导航 + 右侧纸面。
 * 页面只负责纸面里的内容（PageHead + PageBody），不重复画外壳。
 */
export interface ShellProps {
  active: PageId
  onNavigate: (page: PageId) => void
  /** 侧栏底部：连接状态 + 版本，由调用方从 real 后端取 */
  footer?: ReactNode
  children: ReactNode
}

export function Shell({ active, onNavigate, footer, children }: ShellProps) {
  // rspack 给 asset/resource 的文件名带 contenthash，index.html 里写不出稳定地址；
  // 挂载后把占位的 <link rel="icon"> 指到品牌标真实 URL，和侧栏用同一份 SVG。
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.href = brandUrl
    }
  }, [])

  return (
    <div className={styles.shell}>
      <Sidebar
        brand={<SidebarBrand name="chat-deepseek" subtitle="管理控制台" icon={<BrandMark />} />}
        footer={footer}
      >
        {NAV.map(({ id, label, Icon }) => (
          <SidebarItem
            key={id}
            icon={<Icon />}
            label={label}
            active={id === active}
            onClick={() => {
              onNavigate(id)
            }}
          />
        ))}
      </Sidebar>
      <Paper className={styles.paper}>{children}</Paper>
    </div>
  )
}

/** 页面标题行：左侧标题、右侧主/次操作。所有页面共用同一组尺寸。 */
export function PageHead({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className={styles.head}>
      <h1 className={styles.title}>{title}</h1>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}

/** 页面内容区：撑满纸面剩余高度，纵向 16 间距；内部滚动由页面自己决定。 */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `${styles.body} ${className}` : styles.body}>{children}</div>
}
