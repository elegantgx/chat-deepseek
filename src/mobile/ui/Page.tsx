import type { ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Page.module.css'

/**
 * 二级页骨架（visual §4）：整页纵向 flex、内容区自己滚动、底部说明固定在底部。
 * 背景只有两种：聊天/登录用 `--bg`，设置类用 `--group-bg`（卡片浮在其上）。
 * 安全区由 Shell 统一留，这里不重复 padding，避免叠加。
 */
export interface PageProps {
  tone?: 'bg' | 'group'
  children: ReactNode
  className?: string
}

export const Page = ({ tone = 'group', children, className }: PageProps) => (
  <div className={cx(styles.page, tone === 'bg' ? styles.bg : '', className)}>{children}</div>
)

/**
 * 内容区内边距按示意里的四套骨架取：
 * settings 2 18、server/form/picker 4 18、auth 0 36、login 0 18。
 * 默认允许滚动——示意是固定画布所以写 overflow:hidden，真机内容会超过一屏。
 */
export type PageBodyPad = 'settings' | 'server' | 'auth' | 'login' | 'none'

export interface PageBodyProps {
  pad?: PageBodyPad
  scroll?: boolean
  children: ReactNode
  className?: string
}

export const PageBody = ({
  pad = 'settings',
  scroll = true,
  children,
  className,
}: PageBodyProps) => (
  <div className={cx(styles.body, styles[pad], scroll ? styles.scroll : '', className)}>
    {children}
  </div>
)

/**
 * 页面底部说明（mockup `.settings-footer`）：12/20 居中 --ink-4，
 * 版本那一行用等宽 11.5；没有版本行就只渲染 children。
 */
export interface PageFooterProps {
  version?: ReactNode
  children?: ReactNode
  className?: string
}

export const PageFooter = ({ version, children, className }: PageFooterProps) => (
  <footer className={cx(styles.footer, className)}>
    {version ? <div className={styles.version}>{version}</div> : null}
    {children}
  </footer>
)
