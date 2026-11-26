import { useCallback, useEffect, useRef, useState } from 'react'
import { PageBody, PageHead, navigate, normalizeHostError, useHost, useRequest } from '../../app'
import type { HostError } from '../../app'
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
  RefreshIcon,
  Table,
  TextButton,
  Toast,
} from '../../ui'
import type { TableColumn, ToastTone } from '../../ui'
import styles from './backup.module.css'
import { formatBackupSize, formatBackupTime, formatFailure } from './format'

type OperationKind = 'create' | 'restore' | 'delete'

interface Operation {
  kind: OperationKind
  /** 恢复 / 删除针对的归档文件名；创建时为空 */
  file?: string
}

interface ToastMessage {
  tone: ToastTone
  text: string
}

const FAILURE_PREFIX: Record<OperationKind, string> = {
  create: '备份失败',
  restore: '恢复失败',
  delete: '删除失败',
}

/**
 * 写操作失败按 code 呈现：`unavailable` 的 message 已经是可读原因
 * （如「服务运行中，备份已暂停」），直接用；其它错误带上 code 便于排查。
 * 不解析 message 做逻辑判断。
 */
function writeFailure(kind: OperationKind, failure: HostError): string {
  if (failure.code === 'unavailable') {
    return failure.message
  }
  return `${FAILURE_PREFIX[kind]}：${formatFailure(failure)}`
}

/** 读失败给一句能行动的说明；`unavailable` 的 message 本身已是原因 */
function readFailure(failure: HostError): string {
  if (failure.code === 'unavailable') {
    return failure.message
  }
  return `${failure.message}（${failure.code}）`
}

/**
 * 备份页：`system.status` 决定警告条与禁用，`backup.list` 提供归档列表。
 * 两个请求都拿到结果之前不判断服务状态，避免首帧闪一下错误的状态。
 */
export function BackupPage() {
  const host = useHost()
  const status = useRequest<SystemStatus>('system.status')
  const list = useRequest<BackupList>('backup.list')

  const [operation, setOperation] = useState<Operation | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BackupEntry | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  /** 同步守卫：state 要等下一次渲染，双击时只靠 state 仍可能排进第二个写操作 */
  const inFlight = useRef<Operation | null>(null)
  const toastTimer = useRef<number | null>(null)

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
    }
  }, [])

  const retry = useCallback(() => {
    status.reload()
    list.reload()
  }, [status, list])

  const backups = list.data?.backups ?? []
  const ready = status.data !== null && list.data !== null
  const loading = status.loading || list.loading
  const readError = status.error ?? list.error
  const canOperate = ready && readError === null
  const running = status.data?.service.state === 'running'
  const busy = operation !== null
  const creating = operation?.kind === 'create'
  const restoring = operation?.kind === 'restore'
  const deleting = operation?.kind === 'delete'

  const begin = (next: Operation): boolean => {
    if (inFlight.current) {
      return false
    }
    inFlight.current = next
    setOperation(next)
    return true
  }

  const settle = () => {
    inFlight.current = null
    setOperation(null)
  }

  const handleCreate = async () => {
    if (!canOperate || running || !begin({ kind: 'create' })) {
      return
    }
    try {
      const created = (await host.request('backup.create')) as BackupCreated
      showToast('success', `备份已写入 ${created.file}`)
      list.reload()
    } catch (failure: unknown) {
      showToast('error', writeFailure('create', normalizeHostError(failure)))
    } finally {
      settle()
    }
  }

  const handleRestore = async () => {
    const target = restoreTarget
    if (!target || running || !begin({ kind: 'restore', file: target.file })) {
      return
    }
    try {
      const result = (await host.request('backup.restore', {
        file: target.file,
      })) as BackupRestored
      showToast('success', `已恢复 ${result.restored.length} 项`)
      // 恢复会覆盖 config.json/chat.db，列表目录和服务监听都可能变，两个读请求都要重拉
      list.reload()
      status.reload()
    } catch (failure: unknown) {
      showToast('error', writeFailure('restore', normalizeHostError(failure)))
    } finally {
      setRestoreTarget(null)
      settle()
    }
  }

  const handleDelete = async () => {
    const target = deleteTarget
    if (!target || !begin({ kind: 'delete', file: target.file })) {
      return
    }
    try {
      await host.request('backup.delete', { file: target.file })
      showToast('success', `已删除 ${target.file}`)
      list.reload()
    } catch (failure: unknown) {
      showToast('error', writeFailure('delete', normalizeHostError(failure)))
    } finally {
      setDeleteTarget(null)
      settle()
    }
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
            disabled={!canOperate || running || busy}
            onClick={handleCreate}
          >
            {creating ? '正在备份…' : '立即备份'}
          </Button>
        }
      />
      <PageBody>
        {canOperate && running ? (
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
          {readError && !loading ? (
            <div className={styles.empty}>
              <EmptyState
                title="无法读取备份数据"
                description={readFailure(readError)}
                icon={<AlertTriangleIcon />}
                action={
                  <Button tone="secondary" icon={<RefreshIcon size={16} />} onClick={retry}>
                    重试
                  </Button>
                }
              />
            </div>
          ) : !ready ? (
            <div className={styles.empty}>
              <EmptyState title="正在读取备份…" icon={<ArchiveIcon />} />
            </div>
          ) : backups.length === 0 ? (
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
          {canOperate ? (
            <CardFooter
              end={
                <span className={styles.footerDir} title={list.data?.dir}>
                  {list.data?.dir}
                </span>
              }
            >
              共 {backups.length} 个备份
            </CardFooter>
          ) : null}
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
