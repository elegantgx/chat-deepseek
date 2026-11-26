import styles from './StatusFooter.module.css'

/** 连接状态：与 StatusPill 的三态一致，但侧栏里用 6px 圆点而不是胶囊 */
export type ConnectionState = 'ok' | 'off' | 'err'

const DOT_CLASS: Record<ConnectionState, string> = {
  ok: styles.dotOk,
  off: styles.dotOff,
  err: styles.dotErr,
}

/** 侧栏底部两行：`<圆点> 本地 · 运行中` 与版本号 */
export function StatusFooter({
  state,
  label,
  version,
}: {
  state: ConnectionState
  label: string
  version: string
}) {
  return (
    <>
      <span className={styles.conn}>
        <span className={`${styles.dot} ${DOT_CLASS[state]}`} aria-hidden="true" />
        {label}
      </span>
      <span className={styles.version}>{version}</span>
    </>
  )
}
