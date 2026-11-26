import styles from './Paper.module.css'
import { cx } from './cx'
import type { ReactNode } from 'react'

/**
 * 纸面板：浮在窗口材质上的不透明内容层，只有左上角 12px 圆角。
 * 顶边 / 左边各 1px 轮廓（原稿 .panel::before）；右边与底边直接出窗，不画线。
 * 高度由使用方控制（页面里通常 flex: 1），组件本身不写死 800。
 */
export interface PaperProps {
  children: ReactNode
  className?: string
}

export function Paper({ children, className }: PaperProps) {
  return <section className={cx(styles.paper, className)}>{children}</section>
}
