import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx.js'
import styles from './Stack.module.css'

/**
 * 组合用的纵向间距容器。屏里只决定“隔多少”，具体间距值都在示意里量过：
 * 例如登录表单字段 18、胶囊字段 12、表单卡字段 16。
 * 不用每屏复制一份 margin，也避免各屏自己发明间距。
 */
export interface StackProps {
  gap?: number
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export const Stack = ({ gap = 0, children, className, style }: StackProps) => (
  <div className={cx(styles.stack, className)} style={{ gap, ...style }}>
    {children}
  </div>
)

/**
 * 卡片/提示的默认垂直节奏（mockup `.card-stack` / `.stack`）：相邻块 24，
 * 但“提示条 + 紧随的动作行”保持 12，避免把同一条提示和它的操作拆成两组。
 * 屏幕自己不需要再写 margin；它是 36 屏内容区最常用的容器。
 */
export interface CardStackProps {
  children: ReactNode
  className?: string
}

export const CardStack = ({ children, className }: CardStackProps) => (
  <div className={cx(styles.cardStack, className)}>{children}</div>
)

/**
 * 显式垂直间隔：表单主按钮前的 16/20/28/40 是一次性节奏，不该塞进组件 margin。
 * 用它比在屏里写 style 更容易看出“这是间距而不是布局”。
 */
export const Spacer = ({ size }: { size: number }) => (
  <div style={{ height: size }} aria-hidden="true" />
)

/**
 * 卡片内并排按钮（visual §5.1）：间距 10、每个按钮 flex:1、高 44。
 * 状态卡的“重启 / 停止服务”和小屏确认都用它。
 */
export interface ButtonRowProps {
  children: ReactNode
  className?: string
}

export const ButtonRow = ({ children, className }: ButtonRowProps) => (
  <div className={cx(styles.buttonRow, className)}>{children}</div>
)
