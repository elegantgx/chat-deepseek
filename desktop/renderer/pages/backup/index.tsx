import { useCallback, useEffect, useRef, useState } from 'react'
import { PageBody, PageHead, navigate } from '../../app'
import type {
  BackupCreated,
  BackupEntry,
  BackupList,
  BackupRestored,
  SystemStatus,
} from '../../app/ipc-types'
import {
  AlertTriangleIcon,
  ArchiveIcon,
  Button,
  Card,
  CardFooter,
  Dialog,
  DownloadIcon,
  EmptyState,
  Table,
  TextButton,
  Toast,
} from '../../ui'
import type { TableColumn, ToastTone } from '../../ui'
import styles from './backup.module.css'
import {
  FAILURE_SAMPLES,
  INITIAL_BACKUP_LIST,
  NEW_BACKUP_SIZE,
  RESTORED_ITEMS,
  serviceStatus,
} from './fixtures'
import {
  backupStamp,
  formatBackupSize,
  formatBackupTime,
  formatFailure,
  localRfc3339,
} from './format'

type OperationKind = 'create' | 'restore' | 'delete'

interface Operation {
  kind: OperationKind
  /** 恢复 / 删除针对的归档文件名；创建时为空 */
  file?: string
}

interface Scenario {
  running: boolean
  empty: boolean
  dialog: boolean
  fail: boolean
}

interface ToastMessage {
  tone: ToastTone
  text: string
}

/**
 * hash 尾巴给截图脚本和手工验收用：`#backup-running` / `#backup-empty` /
 * `#backup-dialog` / `#backup-fail`。外壳只认页面名和主题，其余由页面自己解释。
 * `#backup-fail` 是失败样本态：创建、恢复、删除分别命中一条 IPC 错误。
 */
function readScenario(): Scenario {
  const tokens = window.location.hash.replace(/^#\/?/, '').toLowerCase().split('-')
  return {
    running: tokens.includes('running'),
    empty: tokens.includes('empty'),
    dialog: tokens.includes('dialog'),
    fail: tokens.includes('fail'),
  }
}

/** 备份页：列表撑满剩余高度，底部收口条固定，写操作一次只允许一个在途。 */
export function BackupPage() {
  const [scenario] = useState<Scenario>(readScenario)
  const [status] = useState<SystemStatus>(() => serviceStatus(scenario.running))
  const [backupList, setBackupList] = useState<BackupList>(() =>
    scenario.empty
      ? { ...INITIAL_BACKUP_LIST, backups: [] }
      : { ...INITIAL_BACKUP_LIST, backups: [...INITIAL_BACKUP_LIST.backups] }
  )
  const [operation, setOperation] = useState<Operation | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(() =>
    scenario.dialog ? INITIAL_BACKUP_LIST.backups[0] : null
  )
  const [deleteTarget, setDeleteTarget] = useState<BackupEntry | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  /** 同步守卫：state 要等下一次渲染，双击时只靠 state 仍可能排进第二个写操作 */
  const inFlight = useRef<Operation | null>(null)
  const operationTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)

  const backups = backupList.backups
  const running = status.service.state === 'running'
  const busy = operation !== null
  const creating = operation?.kind === 'create'
  const restoring = operation?.kind === 'restore'
  const deleting = operation?.kind === 'delete'

  const showToast = useCallback((tone: ToastTone, text: string) => {
    setToast({ tone, text })
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current)
    }
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null
      setToast(null)
    }, 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current)
      }
      if (operationTimer.current !== null) {
        window.clearTimeout(operationTimer.current)
      }
    }
  }, [])

  const settle = () => {
    inFlight.current = null
    setOperation(null)
  }

  /** 先占住在途标记再起定时器，保证同一时刻只有一个写操作 */
  const schedule = (next: Operation, delay: number, finish: () => void) => {
    if (inFlight.current) {
      return
    }
    inFlight.current = next
    setOperation(next)
    operationTimer.current = window.setTimeout(() => {
      operationTimer.current = null
      finish()
      settle()
    }, delay)
  }

  const handleCreate = () => {
    if (running || inFlight.current) {
      return
    }
    schedule({ kind: 'create' }, 900, () => {
      if (scenario.fail) {
        showToast('error', `备份失败：${formatFailure(FAILURE_SAMPLES.serviceRunning)}`)
        return
      }
      const now = new Date()
      const file = `chat-deepseek-${backupStamp(now)}.zip`
      const created: BackupCreated = {
        file,
        path: `${backupList.dir}/${file}`,
        size: NEW_BACKUP_SIZE,
      }
      setBackupList((current) => ({
        ...current,
        backups: [{ ...created, mtime: localRfc3339(now) }, ...current.backups],
      }))
      showToast('success', `备份已写入 ${created.file}`)
    })
  }

  const handleRestore = () => {
    const target = restoreTarget
    if (!target || running || inFlight.current) {
      return
    }
    schedule({ kind: 'restore', file: target.file }, 800, () => {
      if (scenario.fail) {
        showToast('error', `恢复失败：${formatFailure(FAILURE_SAMPLES.missing)}`)
      } else {
        const result: BackupRestored = { ok: true, restored: RESTORED_ITEMS }
        showToast('success', `已恢复 ${result.restored.length} 项`)
      }
      setRestoreTarget(null)
    })
  }

  const handleDelete = () => {
    const target = deleteTarget
    if (!target || inFlight.current) {
      return
    }
    schedule({ kind: 'delete', file: target.file }, 600, () => {
      if (scenario.fail) {
        showToast('error', `删除失败：${formatFailure(FAILURE_SAMPLES.traversal)}`)
      } else {
        setBackupList((current) => ({
          ...current,
          backups: current.backups.filter((item) => item.file !== target.file),
        }))
        showToast('success', `已删除 ${target.file}`)
      }
      setDeleteTarget(null)
    })
  }

  const closeRestore = () => {
    if (!inFlight.current) {
      setRestoreTarget(null)
    }
  }

  const closeDelete = () => {
    if (!inFlight.current) {
      setDeleteTarget(null)
    }
  }

  const columns: TableColumn<BackupEntry>[] = [
    {
      key: 'file',
      header: '文件名',
      width: '40%',
      render: (row) => (
        <span className={styles.file} title={row.file}>
          {row.file}
        </span>
      ),
    },
    {
      key: 'time',
      header: '时间',
      width: '20%',
      render: (row) => <span className={styles.time}>{formatBackupTime(row.mtime)}</span>,
    },
    {
      key: 'size',
      header: '大小',
      width: '10%',
      render: (row) => <span className={styles.size}>{formatBackupSize(row.size)}</span>,
    },
  ]

  return (
    <>
      <PageHead
        title="备份"
        actions={
          <Button
            icon={<DownloadIcon size={16} />}
            disabled={running || busy}
            onClick={handleCreate}
          >
            {creating ? '正在备份…' : '立即备份'}
          </Button>
        }
      />
      <PageBody>
        {running ? (
          <div className={styles.banner}>
            <AlertTriangleIcon size={16} />
            <span className={styles.bannerText}>服务运行中，备份已暂停。请先停止服务。</span>
            <TextButton
              tone="quiet"
              className={styles.bannerAction}
              onClick={() => {
                navigate('service')
              }}
            >
              去停止
            </TextButton>
          </div>
        ) : null}

        <Card grow clip>
          {backups.length === 0 ? (
            <div className={styles.empty}>
              <EmptyState
                title="还没有备份"
                description="停止服务后点「立即备份」。"
                icon={<ArchiveIcon />}
              />
            </div>
          ) : (
            <div className={styles.tableScroll}>
              <Table<BackupEntry>
                columns={columns}
                rows={backups}
                rowKey={(row) => row.file}
                caption="备份列表"
                actions={{
                  width: '30%',
                  render: (row) => (
                    <>
                      <TextButton
                        tone="accent"
                        disabled={running || busy}
                        onClick={() => {
                          if (!running && !inFlight.current) {
                            setRestoreTarget(row)
                          }
                        }}
                      >
                        恢复
                      </TextButton>
                      <TextButton
                        tone="danger"
                        disabled={busy}
                        onClick={() => {
                          if (!inFlight.current) {
                            setDeleteTarget(row)
                          }
                        }}
                      >
                        删除
                      </TextButton>
                    </>
                  ),
                }}
              />
            </div>
          )}
          <CardFooter
            end={
              <span className={styles.footerDir} title={backupList.dir}>
                {backupList.dir}
              </span>
            }
          >
            共 {backups.length} 个备份
          </CardFooter>
        </Card>
      </PageBody>

      <Dialog
        open={restoreTarget !== null}
        title="恢复这份备份？"
        description={
          restoreTarget
            ? `将用 ${restoreTarget.file} 覆盖 config.json、chat.db、master.key 和 files/，且不可撤销。`
            : undefined
        }
        onClose={busy ? undefined : closeRestore}
        actions={
          <>
            <Button tone="secondary" disabled={busy} onClick={closeRestore}>
              取消
            </Button>
            <Button tone="dangerSolid" disabled={busy} onClick={handleRestore}>
              {restoring ? '正在恢复…' : '恢复'}
            </Button>
          </>
        }
      />

      <Dialog
        open={deleteTarget !== null}
        title="删除这份备份？"
        description={deleteTarget ? `${deleteTarget.file} 将被永久删除，无法恢复。` : undefined}
        onClose={busy ? undefined : closeDelete}
        actions={
          <>
            <Button tone="secondary" disabled={busy} onClick={closeDelete}>
              取消
            </Button>
            <Button tone="dangerSolid" disabled={busy} onClick={handleDelete}>
              {deleting ? '正在删除…' : '删除'}
            </Button>
          </>
        }
      />

      <Dialog
        open={creating === true}
        title="正在创建备份"
        description="正在打包数据目录，请稍候。"
      />

      {toast ? (
        <Toast tone={toast.tone} className={styles.toast}>
          {toast.text}
        </Toast>
      ) : null}
    </>
  )
}
