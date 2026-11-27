import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useRoute } from '../../app/navigation.js'
import { useHost, useReady } from '../../app/runtime.js'
import { useToast } from '../../app/toast.js'
import {
  Blocking,
  Card,
  Dialog,
  ListRow,
  Notice,
  Page,
  PageBody,
  RestoreIcon,
  Spinner,
  TopBar,
  TrashIcon,
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
import { useDataStrings } from './strings.js'
import styles from './BackupDetail.module.css'

export type BackupDialog = 'none' | 'restore' | 'delete'

/**
 * 备份详情与两个确认屏共用同一份内容。
 *
 * 确认屏不是复制一份详情，而是「详情 + 弹窗」，这样返回时数据不会闪一下重载，
 * 恢复中/删除中的状态屏也能从同一个入口衔接（visual §7.1）。
 */
export const BackupDetailView = ({ dialog }: { dialog: BackupDialog }) => {
  const t = useDataStrings()
  const host = useHost()
  const ready = useReady()
  const navigate = useNavigate()
  const route = useRoute()
  const { showToast } = useToast()

  const fileParam = route.params.get('file')
  const restoringParam = dialog === 'none' && route.params.get('restoring') === '1'

  const [list, setList] = useState<BackupList | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [restoring, setRestoring] = useState(restoringParam)
  const [actionError, setActionError] = useState<string | null>(null)
  const restoreStarted = useRef(false)

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

  const entry =
    list === null
      ? null
      : (list.backups.find((item) => item.file === fileParam) ?? list.backups[0] ?? null)
  const dir = list?.dir || fallbackBackupDir(ready.dataDir)

  const clearRestoringRoute = useCallback(
    (file: string | null) => {
      // 去掉 restoring 参数：失败后留在详情页，刷新也不会再次触发恢复
      navigate('server-backup-detail', file ? { file } : undefined)
    },
    [navigate]
  )

  useEffect(() => {
    // 列表已经回来但没有可用备份（或读取失败）时不能一直盖着“正在恢复”
    if (restoringParam && list !== null && !entry && !restoreStarted.current) {
      setRestoring(false)
      setActionError(t.backupMissing)
      clearRestoringRoute(fileParam)
      return
    }
    if (!restoringParam || !entry || restoreStarted.current) {
      return
    }
    restoreStarted.current = true
    setActionError(null)
    void (async () => {
      let restored = false
      let restarted = false
      try {
        // 恢复要求服务停止；如果它正在跑，先停再恢复，成功后统一重启（“恢复并重启”）
        const status = await host.request('service.status', {}).catch(() => null)
        const running = readServiceRunning(status)
        if (running !== false) {
          try {
            await host.request('service.stop', {})
          } catch (error) {
            // 状态未知时不把“停止失败”当致命错误：恢复本身还会再校验一次 WAL
            if (running === true) {
              throw error
            }
          }
        }
        await host.request('backup.restore', { file: entry.file })
        restored = true
        await host.request('service.start', {})
        restarted = true
        showToast(t.backupRestoreDone)
      } catch {
        setActionError(restored ? t.backupRestoredPartial : t.backupRestoreFailed)
      } finally {
        setRestoring(false)
        if (restarted) {
          navigate('server-backups')
        } else {
          clearRestoringRoute(entry.file)
        }
      }
    })()
  }, [clearRestoringRoute, entry, fileParam, host, list, navigate, restoringParam, showToast, t])

  const closeDialog = () => {
    if (entry) {
      navigate('server-backup-detail', { file: entry.file })
    } else {
      navigate('server-backups')
    }
  }

  /** 恢复失败后重试：reset 掉“已启动过”的标记，再回到带 restoring 参数的路由 */
  const retryRestore = () => {
    if (!entry) {
      return
    }
    restoreStarted.current = false
    setActionError(null)
    setRestoring(true)
    navigate('server-backup-detail', { file: entry.file, restoring: '1' })
  }

  return (
    <Page tone="group">
      <TopBar title={t.backupName} onBack={() => navigate('server-backups')} />
      <PageBody pad="server">
        {entry ? (
          <>
            <Card>
              <ListRow title={t.backupTime} value={formatBackupTime(entry.mtime)} />
              <ListRow title={t.backupLocation} value={formatBackupLocation(dir, ready.dataDir)} />
              <ListRow title={t.backupSize} value={formatBackupSize(entry.size)} />
            </Card>

            <Card standalone>
              <ListRow
                icon={<RestoreIcon />}
                title={t.backupRestoreRestart}
                onClick={() => navigate('server-backup-restore-confirm', { file: entry.file })}
              />
              <ListRow
                icon={<TrashIcon />}
                title={t.backupDelete}
                danger
                onClick={() => navigate('server-backup-delete-confirm', { file: entry.file })}
              />
            </Card>

            {actionError ? (
              <Notice
                tone="error"
                className={styles.error}
                actions={[{ label: t.dataRetry, onClick: retryRestore }]}
              >
                {actionError}
              </Notice>
            ) : null}
          </>
        ) : loadFailed ? (
          <Notice tone="error" actions={[{ label: t.dataRetry, onClick: () => void refresh() }]}>
            {t.backupListFailed}
          </Notice>
        ) : list !== null ? (
          <Notice
            tone="error"
            actions={[{ label: t.backToList, onClick: () => navigate('server-backups') }]}
          >
            {t.backupMissing}
          </Notice>
        ) : (
          <div className={styles.loading}>
            <Spinner size="lg" />
          </div>
        )}
      </PageBody>

      <Dialog
        open={dialog !== 'none' && entry !== null}
        title={dialog === 'restore' ? t.backupRestoreTitle : t.backupDeleteTitle}
        body={
          entry
            ? dialog === 'restore'
              ? t.backupRestoreBody.replace('{time}', formatBackupTime(entry.mtime))
              : t.backupDeleteBody
            : undefined
        }
        cancelLabel={t.cancel}
        confirmLabel={dialog === 'restore' ? t.backupRestoreRestart : t.delete}
        danger
        onCancel={closeDialog}
        onConfirm={() => {
          if (!entry) {
            return
          }
          if (dialog === 'restore') {
            navigate('server-backup-detail', { file: entry.file, restoring: '1' })
          } else {
            navigate('server-backups', { deleting: entry.file })
          }
        }}
      />

      {restoring ? <Blocking title={t.backupRestoringTitle} note={t.backupRestoringNote} /> : null}
    </Page>
  )
}
