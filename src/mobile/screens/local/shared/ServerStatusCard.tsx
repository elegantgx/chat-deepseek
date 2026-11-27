import type { ReactNode } from 'react'
import { useStrings } from '../../strings.js'
import { Card, KvList, KvRow, Pill, StatusActions, StatusDot } from '../../../ui/index.js'
import type { StatusTone } from '../../../ui/index.js'
import { localStrings } from '../strings.js'
import { compactPath } from './format.js'
import styles from './ServerStatusCard.module.css'

/**
 * 本机状态卡（visual §5.6）：状态圆点 + 24/600 状态字 + 右侧“内置后端”胶囊，
 * 下面三行键值，最后是动作区。九个本机屏都用它，保证圆点语义和间距只有一处。
 *
 * 这里没有直接用 `ui/StatusHead`：它把 pill 包了一层行内 span，行盒会让胶囊比示意
 * 低 1px（已用截图对齐量过）。这里按示意把 pill 作为 flex 直接子项，尺寸与颜色不变。
 *
 * 数据目录只展示末两段：完整 Android 私有路径在 390 宽下会被省略号截断（§4 行值规则），
 * 与示意的 `files/data` 一致；真实值仍从 `config.get` 来。
 */
export interface ServerStatusCardProps {
  tone: StatusTone
  title: string
  listen: string
  version: string
  dataDir: string
  actions?: ReactNode
}

export const ServerStatusCard = ({
  tone,
  title,
  listen,
  version,
  dataDir,
  actions,
}: ServerStatusCardProps) => {
  const t = useStrings(localStrings)
  return (
    <Card padding="status">
      <div className={styles.head}>
        <StatusDot tone={tone} />
        <span className={styles.title}>{title}</span>
        <Pill tone="muted" className={styles.pill}>
          {t.internalBackend}
        </Pill>
      </div>
      <KvList>
        <KvRow label={t.listen} value={listen || '—'} />
        <KvRow label={t.version} value={version || '—'} />
        <KvRow label={t.dataDir} value={compactPath(dataDir, 2) || '—'} />
      </KvList>
      {actions ? <StatusActions>{actions}</StatusActions> : null}
    </Card>
  )
}
