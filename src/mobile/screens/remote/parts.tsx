import type { ReactNode } from 'react'
import { GlobeIcon } from '../../ui/index.js'
import { hostOf } from './data.js'
import styles from './parts.module.css'

/**
 * 本组专属的小零件。通用组件库里没有这两个形态，又不该为了两屏去改 `src/mobile/ui`：
 * - ServerChip：登录页顶部的服务器胶囊（56 高 / 28 圆角 / host + 已连接）；
 * - PrepRow：添加页「需要准备」里的 52 高圆点行。
 */

export const ServerChip = ({ baseUrl, status }: { baseUrl: string; status: string }) => (
  <div className={styles.chip}>
    <GlobeIcon className={styles.icon} size={20} />
    <span className={styles.name}>{hostOf(baseUrl)}</span>
    <span className={styles.status}>
      <span className={styles.dot} aria-hidden="true" />
      {status}
    </span>
  </div>
)

export const PrepRow = ({ children }: { children: ReactNode }) => (
  <div className={styles.prepRow}>
    <span className={styles.prepDot} aria-hidden="true" />
    {children}
  </div>
)
