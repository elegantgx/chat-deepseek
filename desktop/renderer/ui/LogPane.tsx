import { Card, CardFooter, CardHeader } from './Card'
import { TextButton } from './TextButton'
import styles from './LogPane.module.css'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogLine {
  /** 稳定 key；不传则按「时间 + 序号」拼 */
  id?: string
  /** 已格式化好的时间，组件负责加方括号 */
  time: string
  level: LogLevel
  message: string
}

export interface LogPaneFooterAction {
  label: string
  onClick?: () => void
}

export interface LogPaneProps {
  lines: ReadonlyArray<LogLine>
  title?: string
  /** 总行数（可能大于当前展示的行）；不传等于 lines.length */
  count?: number
  onClear?: () => void
  clearLabel?: string
  /** 收口链接，如「查看全部日志」 */
  footerAction?: LogPaneFooterAction
  emptyText?: string
  /** 日志区高度，默认 320 */
  height?: number
  className?: string
}

/**
 * 日志区是普通白卡，不是下陷块：卡内标题 + 清屏、发丝线、等宽行（行间无分隔线），
 * 底部用「共 N 行」收口。颜色全部走 --log-* 语义 token。
 */
export function LogPane({
  lines,
  title = '最近日志',
  count,
  onClear,
  clearLabel = '清屏',
  footerAction,
  emptyText = '暂无日志',
  height,
  className,
}: LogPaneProps) {
  const total = count ?? lines.length
  const formatted = new Intl.NumberFormat('en-US').format(total)

  return (
    <Card clip className={className}>
      <CardHeader
        title={title}
        actions={
          onClear ? (
            <TextButton tone="quiet" onClick={onClear}>
              {clearLabel}
            </TextButton>
          ) : undefined
        }
      />
      <div
        className={styles.log}
        role="log"
        aria-label={title}
        tabIndex={0}
        style={height === undefined ? undefined : { height }}
      >
        {lines.length === 0 ? (
          <div className={styles.empty}>{emptyText}</div>
        ) : (
          lines.map((line, index) => (
            <div
              key={line.id ?? `${line.time}-${index}`}
              className={`${styles.line}${line.level === 'info' ? '' : ` ${styles.strongLine}`}`}
            >
              <span className={styles.time}>[{line.time}]</span>
              <span className={`${styles.level} ${styles[line.level]}`}>
                {line.level.toUpperCase()}
              </span>
              <span className={styles.message}>{line.message}</span>
            </div>
          ))
        )}
      </div>
      <CardFooter>
        <span className={styles.footText}>
          共 {formatted} 行
          {footerAction ? (
            <>
              <span className={styles.dot} aria-hidden="true">
                ·
              </span>
              <TextButton tone="accent" onClick={footerAction.onClick}>
                {footerAction.label}
              </TextButton>
            </>
          ) : null}
        </span>
      </CardFooter>
    </Card>
  )
}
