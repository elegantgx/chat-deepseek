import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useRoute } from '../../app/navigation.js'
import { useHost, useReady } from '../../app/runtime.js'
import { useToast } from '../../app/toast.js'
import {
  ArchiveIcon,
  Button,
  Card,
  Empty,
  KvList,
  KvRow,
  ListRow,
  Notice,
  Page,
  PageBody,
  PlusIcon,
  ProgressBlock,
  Spinner,
  StatusActions,
  StatusHead,
  TopBar,
} from '../../ui/index.js'
import {
  fallbackBackupDir,
  formatBackupLocation,
  formatBackupSize,
  formatBackupTime,
  readBackupList,
  readServiceRunning,
} from './backupFormat.js'
import type { BackupList } from './backupFormat.js'
import { RowStatus } from './RowStatus.js'
import { useDataStrings } from './strings.js'
import styles from './ServerBackups.module.css'

const formatNow = (): string => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}`
}

/**
 * 本机备份列表（#22）。
 *
 * 产品规则：服务运行中不能新建备份，也不靠后端报错兜——这里主动读
 * `service.status`，不满足时把“新建备份”整行置灰并写清原因。
 * 新建入口永远在列表最上面；列表为空时只留空态卡，不额外画一行空入口。
 */
export const ServerBackupsScreen = () => {
  const t = useDataStrings()
  const host = useHost()
  const ready = useReady()
  const navigate = useNavigate()
  const route = useRoute()
  const { showToast } = useToast()

  const localServer = ready.servers.find((server) => server.id === ready.selectedId)
  // 首帧先用 ready 的三态兜底，避免等 service.status 回来前把按钮误判成可用
  const [serviceRunning, setServiceRunning] = useState<boolean | null>(
    localServer ? localServer.mode !== 'stopped' : null
  )
  const [list, setList] = useState<BackupList | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null)
  const deleteStarted = useRef<string | null>(null)

  const deletingParam = route.params.get('deleting')

  const refresh = useCallback(async (): Promise<BackupList | null> => {
    try {
      const value = await host.request('backup.list', {})
      const parsed = readBackupList(value)
      if (!parsed) {
        throw new Error('backup.list 返回格式不对')
      }
      setList(parsed)
      setLoadFailed(false)
      return parsed
    } catch {
      setLoadFailed(true)
      return null
    }
  }, [host])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    host
      .request('service.status', {})
      .then((value) => {
        if (!cancelled) {
          const running = readServiceRunning(value)
          if (running !== null) {
            setServiceRunning(running)
          }
        }
      })
      .catch(() => {
        // 状态拿不到时保留 ready 的兜底判断，宁可多禁用一次也不让用户点到会失败的按钮
      })
    return () => {
      cancelled = true
    }
  }, [host])

  // 从详情确认删除后回到列表：这里负责真正的 backup.delete，并在目标行显示行内转圈
  useEffect(() => {
    if (!deletingParam || deleteStarted.current === deletingParam) {
      return
    }
    deleteStarted.current = deletingParam
    setDeleting(deletingParam)
    setFailure(null)
    void (async () => {
      try {
        await host.request('backup.delete', { file: deletingParam })
        await refresh()
        showToast(t.backupDeleted)
      } catch {
        setFailure({
          message: t.backupDeleteFailed,
          retry: () => {
            deleteStarted.current = null
            navigate('server-backups', { deleting: deletingParam })
          },
        })
      } finally {
        setDeleting(null)
        // 清掉 hash 参数，刷新页面不会重放删除；同时把地址恢复成干净的列表
        navigate('server-backups')
      }
    })()
  }, [deletingParam, host, navigate, refresh, showToast, t.backupDeleteFailed, t.backupDeleted])

  const canCreate = serviceRunning === false
  const busy = creating || deleting !== null

  const createBackup = async () => {
    if (!canCreate || busy) {
      return
    }
    setCreating(true)
    setFailure(null)
    try {
      await host.request('backup.create', {})
      await refresh()
      showToast(t.backupCreated)
    } catch {
      setFailure({
        message: t.backupCreateFailed,
        retry: () => void createBackup(),
      })
    } finally {
      setCreating(false)
    }
  }

  const newBackupValue = creating
    ? t.backupCreatingValue
    : deleting
      ? t.backupDeletingValue
      : canCreate
        ? undefined
        : t.needStopService

  const newBackupRow = (
    <ListRow
      icon={<PlusIcon />}
      title={t.newBackup}
      value={newBackupValue}
      muted={!canCreate || busy}
      disabled={!canCreate || busy}
      onClick={canCreate && !busy ? () => void createBackup() : undefined}
    />
  )

  const isEmpty = list !== null && list.backups.length === 0 && !creating && !deleting

  return (
    <Page tone="group">
      <TopBar title={t.backupsTitle} onBack={() => navigate('server-local')} />
      <PageBody pad="server">
        {creating ? (
          <Card padding="status" className={styles.statusCard}>
            <StatusHead tone="busy">{t.backupCreating}</StatusHead>
            <KvList>
              <KvRow label={t.backupTime} value={formatNow()} />
              <KvRow
                label={t.backupLocation}
                value={formatBackupLocationSafe(list, ready.dataDir)}
              />
            </KvList>
            <ProgressBlock label={t.backupPacking} />
            <StatusActions>
              <Button block loading>
                {t.backupCreatingAction}
              </Button>
            </StatusActions>
          </Card>
        ) : isEmpty ? null : (
          <Card>{newBackupRow}</Card>
        )}

        {loadFailed ? (
          <Notice
            tone="error"
            className={styles.notice}
            actions={[{ label: t.dataRetry, onClick: () => void refresh() }]}
          >
            {t.backupListFailed}
          </Notice>
        ) : null}

        {failure ? (
          <Notice
            tone="error"
            className={styles.notice}
            actions={[
              {
                label: t.dataRetry,
                onClick: () => {
                  setFailure(null)
                  failure.retry()
                },
              },
            ]}
          >
            {failure.message}
          </Notice>
        ) : null}

        {list === null && !loadFailed ? (
          <div className={styles.loading}>
            <Spinner size="lg" />
          </div>
        ) : null}

        {isEmpty ? (
          <Card label={t.backupGroup}>
            <Empty
              icon={<ArchiveIcon size={26} />}
              title={t.backupEmptyTitle}
              description={t.backupEmptyDescription}
              action={
                <Button size="xs" disabled={!canCreate} onClick={() => void createBackup()}>
                  {t.backupEmptyAction}
                </Button>
              }
            />
            {canCreate ? null : <p className={styles.emptyReason}>{t.needStopService}</p>}
          </Card>
        ) : list !== null ? (
          <Card label={t.backupGroup} gap={24}>
            {creating ? newBackupRow : null}
            {list.backups.map((entry) => {
              const isDeleting = deleting === entry.file
              return (
                <ListRow
                  key={entry.file}
                  icon={<ArchiveIcon />}
                  title={formatBackupTime(entry.mtime)}
                  value={isDeleting ? undefined : formatBackupSize(entry.size)}
                  right={
                    isDeleting ? <RowStatus tone="busy">{t.backupDeleting}</RowStatus> : undefined
                  }
                  showChevron={!busy}
                  muted={(deleting !== null && !isDeleting) || creating}
                  disabled={busy}
                  onClick={
                    busy ? undefined : () => navigate('server-backup-detail', { file: entry.file })
                  }
                />
              )
            })}
          </Card>
        ) : null}

        {list !== null && !loadFailed ? (
          <p className={styles.note}>
            {deleting ? t.backupDeletingNote : isEmpty ? t.backupEmptyNote : t.backupNote}
          </p>
        ) : null}
      </PageBody>
    </Page>
  )
}

/** 状态卡里的位置：列表已回来就用响应里的 dir，否则用数据目录拼默认备份目录 */
const formatBackupLocationSafe = (list: BackupList | null, dataDir: string): string => {
  if (list?.dir) {
    return formatBackupLocation(list.dir, dataDir)
  }
  return formatBackupLocation(fallbackBackupDir(dataDir), dataDir)
}
