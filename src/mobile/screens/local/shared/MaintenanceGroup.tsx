import { ArchiveIcon, Card, ListRow, SlidersIcon, UserIcon } from '../../../ui/index.js'
import { useNavigate } from '../../../app/navigation.js'
import type { ScreenId } from '../../registry.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import { formatTemplate } from './format.js'
import type { AccountRole } from './useLocalServer.js'

/**
 * 本机维护组（visual §4 的设置行骨架）：账户 / 备份 / 主机参数三行，
 * 单行 52、带副标题 64，只有能进下一层才画箭头。
 *
 * 副标题用真实数量：账户总数来自 `account.list`，备份数来自 `backup.list`；
 * 读取中显示“读取中…”，不硬编码示意里的 1/0。
 */
export interface MaintenanceGroupProps {
  role: AccountRole | null
  accountTotal: number | null
  backupCount: number | null
  /** 本屏 id，传给下一层当返回目标 */
  from: ScreenId
  /** 与上一块的间距：已停止 24、运行中 28（示意里的两种取值） */
  gap: number
}

export const MaintenanceGroup = ({
  role,
  accountTotal,
  backupCount,
  from,
  gap,
}: MaintenanceGroupProps) => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()

  const roleLabel =
    role === 'owner'
      ? t.roleOwner
      : role === 'admin'
        ? t.roleAdmin
        : role === 'member'
          ? t.roleMember
          : null
  const accountSub =
    roleLabel !== null && accountTotal !== null
      ? formatTemplate(t.accountSummary, { role: roleLabel, count: accountTotal })
      : t.reading
  const backupSub =
    backupCount === null
      ? t.reading
      : backupCount === 0
        ? t.noBackups
        : formatTemplate(t.backupCount, { count: backupCount })

  return (
    <Card label={t.maintenance} gap={gap}>
      <ListRow
        icon={<UserIcon size={22} />}
        title={t.accounts}
        subtitle={accountSub}
        showChevron
        onClick={() => navigate('server-accounts', { from })}
      />
      <ListRow
        icon={<ArchiveIcon size={22} />}
        title={t.backups}
        subtitle={backupSub}
        showChevron
        onClick={() => navigate('server-backups', { from })}
      />
      <ListRow
        icon={<SlidersIcon size={22} />}
        title={t.host}
        subtitle={t.hostSub}
        showChevron
        onClick={() => navigate('server-host', { from })}
      />
    </Card>
  )
}
