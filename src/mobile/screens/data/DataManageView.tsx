import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useToast } from '../../app/toast.js'
import { getMe } from '../../../services/api/server.js'
import { clearHistory, exportHistory, importHistory } from '../../../services/chat/backup.js'
import { initChat } from '../../../services/chat/store.js'
import { useSettings } from '../../../services/settings.js'
import {
  ActionRow,
  Button,
  Card,
  Dialog,
  ExportIcon,
  ImportIcon,
  KeyIcon,
  ListRow,
  Notice,
  Page,
  PageBody,
  ProgressBlock,
  StatusHead,
  TopBar,
  Blocking,
} from '../../ui/index.js'
import { DataTrashIcon } from './DataManageIcons.js'
import { clearImportFile, getImportFile, stageImportFile } from './importStaging.js'
import { RowStatus } from './RowStatus.js'
import { useDataStrings } from './strings.js'
import styles from './DataManage.module.css'

export type DataManageMode = 'manage' | 'delete-confirm' | 'import-confirm'

const IMPORT_ACCEPT = '.zip,application/zip,application/x-zip-compressed'

interface ImportProgress {
  processed: number
  total?: number
}

/**
 * 数据管理（#30）与两个确认屏（#32/#33）的共用视图。
 *
 * 破坏性动作的二次确认做成独立路由：删除、导入的确认屏直接可达（截图/深链），
 * 真实流程也从列表跳过去，不在页面里再藏一套弹窗状态机。
 * 导出/导入/删除全部复用浏览器已有的 `services/chat/backup.ts`，格式与事务边界不在移动端重写。
 */
export const DataManageView = ({ mode }: { mode: DataManageMode }) => {
  const t = useDataStrings()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const hasApiKey = useSettings((state) => state.hasApiKey)

  const [authError, setAuthError] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [importFailed, setImportFailed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(false)
  const [dialogClosed, setDialogClosed] = useState(false)
  const [file, setFile] = useState<File | null>(() =>
    mode === 'import-confirm' ? getImportFile() : null
  )

  const sessionReady = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const importLock = useRef(false)

  /** 数据面请求前确保拿到 CSRF；首次进入时顺带刷新“Key 已保存”的状态 */
  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (sessionReady.current) {
      return true
    }
    try {
      const session = await getMe()
      if (!session) {
        setAuthError(true)
        return false
      }
      sessionReady.current = true
      setAuthError(false)
      useSettings.setState({
        hasApiKey: session.hasApiKey ?? useSettings.getState().hasApiKey,
      })
      return true
    } catch {
      setAuthError(true)
      return false
    }
  }, [])

  useEffect(() => {
    void ensureSession()
  }, [ensureSession])

  const busy = exporting || importing || deleting
  // 导入时整页被 Blocking 盖住，底层行保持正常颜色（示意 data-importing）；
  // 导出/删除是在页面上直接发生，底下的行才需要一起降级。
  const visualBusy = exporting || deleting

  const startExport = async () => {
    if (busy) {
      return
    }
    setExporting(true)
    setExportError(false)
    try {
      if (!(await ensureSession())) {
        return
      }
      // 导出读的是聊天 store 里的会话列表；冷启动直接进设置页时它可能还没初始化
      await initChat()
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      // 保存结果由壳的 `chatbridge:file-saved` 事件统一提示；这里再报一次会双 toast。
    } catch {
      setExportError(true)
    } finally {
      setExporting(false)
    }
  }

  const runImport = async (selected: File) => {
    if (importLock.current) {
      return
    }
    importLock.current = true
    setDialogClosed(true)
    setFile(selected)
    setImporting(true)
    setImportProgress({ processed: 0 })
    setImportFailed(false)
    try {
      if (!(await ensureSession())) {
        return
      }
      const count = await importHistory(selected, (processed, total) =>
        setImportProgress({ processed, total })
      )
      clearImportFile()
      showToast(t.dataImportDone.replace('{count}', String(count)))
      navigate('data-manage')
    } catch {
      // 失败时保留文件，重试直接用同一个文件；旧对话由 replaceHistory 保证没被改动
      setImportFailed(true)
    } finally {
      importLock.current = false
      setImporting(false)
      setImportProgress(null)
    }
  }

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) {
      return
    }
    if (mode === 'manage') {
      stageImportFile(selected)
      navigate('data-import-confirm')
      return
    }
    // 确认屏里再选文件：用户已经点过“导入”，选完直接执行
    void runImport(selected)
  }

  const confirmImport = () => {
    if (file) {
      void runImport(file)
      return
    }
    // 直接打开确认屏时没有待导入文件：再拉一次选择器，按钮不做空动作
    setDialogClosed(true)
    inputRef.current?.click()
    setFile(getImportFile())
  }

  const retryImport = () => {
    if (file) {
      void runImport(file)
      return
    }
    inputRef.current?.click()
  }

  const confirmDelete = async () => {
    if (deleting) {
      return
    }
    setDeleting(true)
    setDialogClosed(true)
    setDeleteError(false)
    try {
      if (!(await ensureSession())) {
        return
      }
      await clearHistory()
      clearImportFile()
      showToast(t.dataDeleteDone)
      navigate('data-manage')
    } catch {
      setDeleteError(true)
    } finally {
      setDeleting(false)
    }
  }

  const cancelConfirm = () => {
    clearImportFile()
    navigate('data-manage')
  }

  const importPercent =
    importProgress?.total && importProgress.total > 0
      ? (importProgress.processed / importProgress.total) * 100
      : null

  return (
    <Page tone="group">
      <TopBar
        title={t.dataTitle}
        onBack={() => (mode === 'manage' ? navigate('settings') : cancelConfirm())}
      />
      <PageBody pad="server">
        {authError ? (
          <Notice
            tone="error"
            className={styles.notice}
            actions={[{ label: t.dataRetry, onClick: () => void ensureSession() }]}
          >
            {t.dataSessionExpired}
          </Notice>
        ) : null}

        <Card>
          <ListRow
            icon={<KeyIcon />}
            title={t.dataApiKey}
            value={hasApiKey ? t.dataApiKeySaved : t.dataApiKeyMissing}
            showChevron={!visualBusy}
            muted={visualBusy}
            disabled={busy}
            onClick={busy ? undefined : () => navigate('data-apikey')}
          />
        </Card>

        <Card style={{ marginTop: 24 }}>
          <ListRow
            icon={<ExportIcon />}
            title={t.dataExport}
            showChevron={!visualBusy}
            muted={visualBusy}
            disabled={busy}
            right={exporting ? <RowStatus tone="busy">{t.dataExporting}</RowStatus> : undefined}
            onClick={busy ? undefined : () => void startExport()}
          />
          <ListRow
            icon={<ImportIcon />}
            title={t.dataImport}
            showChevron={!visualBusy}
            muted={exporting || deleting}
            disabled={busy}
            right={
              importFailed ? <RowStatus tone="error">{t.dataImportFailed}</RowStatus> : undefined
            }
            onClick={
              busy
                ? undefined
                : () => {
                    setImportFailed(false)
                    inputRef.current?.click()
                  }
            }
          />
        </Card>

        {exporting ? (
          <Card padding="status" style={{ marginTop: 24 }}>
            <StatusHead tone="busy">{t.dataExportingTitle}</StatusHead>
            <ProgressBlock label={t.dataPacking} />
          </Card>
        ) : null}

        {exportError ? (
          <Notice
            tone="error"
            className={styles.notice}
            actions={[{ label: t.dataRetry, onClick: () => void startExport() }]}
          >
            {t.dataExportFailed}
          </Notice>
        ) : null}

        {importFailed ? (
          <>
            <Notice
              tone="error"
              className={styles.notice}
              actions={[{ label: t.dataRetry, onClick: retryImport }]}
            >
              {t.dataImportFailedNotice}
            </Notice>
            <ActionRow text={t.dataImportRetryHint}>
              <Button variant="text" onClick={retryImport}>
                {t.dataRetry}
              </Button>
              <Button
                variant="text"
                onClick={() => {
                  clearImportFile()
                  setImportFailed(false)
                  setFile(null)
                  navigate('data-manage')
                }}
              >
                {t.dataKeepOriginal}
              </Button>
            </ActionRow>
          </>
        ) : null}

        {deleteError ? (
          <Notice
            tone="error"
            className={styles.notice}
            actions={[{ label: t.dataRetry, onClick: () => void confirmDelete() }]}
          >
            {t.dataDeleteFailed}
          </Notice>
        ) : null}

        <Card standalone>
          <ListRow
            icon={<DataTrashIcon />}
            title={t.dataDeleteAll}
            danger
            muted={visualBusy}
            disabled={busy}
            onClick={busy ? undefined : () => navigate('data-delete-confirm')}
          />
        </Card>

        {!importFailed ? (
          <p className={styles.note}>{exporting ? t.dataExportBlockNote : t.dataNote}</p>
        ) : null}
      </PageBody>

      <input ref={inputRef} type="file" accept={IMPORT_ACCEPT} hidden onChange={onPickFile} />

      <Dialog
        open={mode === 'delete-confirm' && !deleting && !dialogClosed}
        title={t.dataDeleteTitle}
        body={t.dataNote}
        cancelLabel={t.cancel}
        confirmLabel={t.delete}
        danger
        onCancel={cancelConfirm}
        onConfirm={() => void confirmDelete()}
      />

      <Dialog
        open={mode === 'import-confirm' && !importing && !importFailed && !dialogClosed}
        title={t.dataImportTitle}
        body={t.dataImportBody}
        cancelLabel={t.cancel}
        confirmLabel={t.dataImportAction}
        danger
        onCancel={cancelConfirm}
        onConfirm={confirmImport}
      />

      {importing ? (
        <Blocking title={t.dataImportingTitle} note={t.dataImportingNote}>
          <ProgressBlock value={importPercent} />
        </Blocking>
      ) : null}

      {deleting ? <Blocking title={t.dataDeletingTitle} note={t.dataDeletingNote} /> : null}
    </Page>
  )
}
