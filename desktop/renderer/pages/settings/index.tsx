import { useEffect, useRef, useState } from 'react'
import {
  PageBody,
  PageHead,
  normalizeHostError,
  useHost,
  useRequest,
  useSystemStatus,
  useTheme,
} from '../../app'
import type { HostError, ThemeChoice } from '../../app'
import type { ConfigProjection } from '../../app/ipc-types'
import { Button, Card, CardFooter, Dialog, Field, Segmented, StatusPill, Toast } from '../../ui'
import type { SegmentedOption, StatusKind, ToastTone } from '../../ui'
import styles from './settings.module.css'
import { validateApiOrigin, validateBackupDir, validateListen } from './validation'

const THEME_OPTIONS: ReadonlyArray<SegmentedOption<ThemeChoice>> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

interface ToastState {
  tone: ToastTone
  message: string
}

type ServiceTask = 'install' | 'uninstall'
type ConfigField = 'listen' | 'backupDir' | 'apiOrigin'
type Draft = Record<ConfigField, string>
type FieldErrors = Partial<Record<ConfigField, string>>

interface ConfigPatch {
  listen?: string
  backupDir?: string
  apiOrigin?: string
}

function draftFrom(config: ConfigProjection): Draft {
  return {
    listen: config.listen,
    backupDir: config.backupDir,
    apiOrigin: config.apiOrigin,
  }
}

/**
 * 只把改过的字段放进 `config.set`：后端按字段合并，没动的字段不该被前端的
 * trim / 补全规则重新写一遍。用 trim 后的值比较，避免只多一个空格也被当成改动。
 */
function changedFields(baseline: ConfigProjection, draft: Draft): ConfigPatch | null {
  const patch: ConfigPatch = {}
  const listen = draft.listen.trim()
  const backupDir = draft.backupDir.trim()
  const apiOrigin = draft.apiOrigin.trim()
  if (listen !== baseline.listen) {
    patch.listen = listen
  }
  if (backupDir !== baseline.backupDir) {
    patch.backupDir = backupDir
  }
  if (apiOrigin !== baseline.apiOrigin) {
    patch.apiOrigin = apiOrigin
  }
  return Object.keys(patch).length === 0 ? null : patch
}

/**
 * 后端的 `bad_request` 文案以字段名开头（见 internal/ipc/config_write.go），
 * 这里按前缀挂回输入框；认不出的 message 由调用方走 Toast，不能丢。
 */
function badRequestFields(message: string): FieldErrors | null {
  if (message.startsWith('listen')) {
    return { listen: message }
  }
  if (message.startsWith('backupDir')) {
    return { backupDir: message }
  }
  if (message.startsWith('apiOrigin')) {
    return { apiOrigin: message }
  }
  return null
}

function clearFieldError(errors: FieldErrors, field: ConfigField): FieldErrors {
  if (errors[field] === undefined) {
    return errors
  }
  switch (field) {
    case 'listen':
      return { ...errors, listen: undefined }
    case 'backupDir':
      return { ...errors, backupDir: undefined }
    case 'apiOrigin':
      return { ...errors, apiOrigin: undefined }
  }
}

function saveFailureText(error: HostError): string {
  if (error.code === 'internal') {
    return `保存失败：${error.message}`
  }
  return error.message || '保存失败'
}

/** `unavailable` 是后端给的可读原因（unit 已存在、没有 systemd…），原样展示。 */
function serviceFailureText(error: HostError): string {
  if (error.code === 'unavailable') {
    return error.message
  }
  if (error.code === 'internal') {
    return `服务操作失败：${error.message}`
  }
  return error.message || `服务操作失败（${error.code}）`
}

export function SettingsPage() {
  const { choice: theme, setChoice } = useTheme()
  const host = useHost()
  const configState = useRequest<ConfigProjection>('config.get')
  const statusState = useSystemStatus()
  const config = configState.data
  const configError = configState.error
  const systemStatus = statusState.data
  const statusError = statusState.error
  const reloadConfig = configState.reload
  const reloadStatus = statusState.reload

  const [baseline, setBaseline] = useState<ConfigProjection | null>(null)
  const [draft, setDraft] = useState<Draft>({ listen: '', backupDir: '', apiOrigin: '' })
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [serviceTask, setServiceTask] = useState<ServiceTask | null>(null)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  /** state 要下次渲染才生效，双击时用 ref 挡住第二个写请求 */
  const writeInFlight = useRef(false)

  // config.get 回来后才允许编辑：加载中与读取失败时表单保持空值 + 禁用。
  useEffect(() => {
    if (config === null) {
      return
    }
    setBaseline(config)
    setDraft(draftFrom(config))
    setServerErrors({})
  }, [config])

  // Toast 不阻塞操作，3 秒后自行消失（组件本身不带定时器）
  useEffect(() => {
    if (toast === null) {
      return
    }
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  const ready = baseline !== null
  const listenError = ready ? validateListen(draft.listen) : undefined
  const backupError = ready ? validateBackupDir(draft.backupDir) : undefined
  const apiError = ready ? validateApiOrigin(draft.apiOrigin) : undefined
  const hasErrors = Boolean(
    listenError ||
    backupError ||
    apiError ||
    serverErrors.listen ||
    serverErrors.backupDir ||
    serverErrors.apiOrigin
  )
  const patch = baseline === null ? null : changedFields(baseline, draft)
  const dirty = patch !== null
  const busy = saving || serviceTask !== null
  const formDisabled = !ready || busy || configState.loading
  const saveDisabled = !ready || busy || configState.loading || !dirty || hasErrors

  const serviceState = systemStatus?.service.state
  const serviceStatus: StatusKind =
    serviceState === 'running' ? 'running' : serviceState === 'unknown' ? 'error' : 'stopped'
  const serviceStatusLabel =
    systemStatus === null
      ? statusError === null
        ? '读取中…'
        : '状态不可用'
      : serviceState === 'running'
        ? '运行中'
        : serviceState === 'unknown'
          ? '状态未知'
          : '已停止'

  const loadingPlaceholder = configError === null ? '正在读取配置…' : '读取配置失败'
  const saveTitle = !ready
    ? configError === null
      ? '正在读取配置'
      : '读取配置失败'
    : !dirty
      ? '没有未保存的更改'
      : undefined

  function notify(tone: ToastTone, message: string) {
    setToast({ tone, message })
  }

  function updateField(field: ConfigField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors((current) => clearFieldError(current, field))
  }

  async function handleSave() {
    if (writeInFlight.current || !ready || patch === null || hasErrors) {
      return
    }
    writeInFlight.current = true
    setSaving(true)
    setServerErrors({})
    try {
      const result = (await host.request('config.set', patch)) as ConfigProjection
      setBaseline(result)
      setDraft(draftFrom(result))
      notify('success', '设置已保存')
    } catch (failure) {
      const error = normalizeHostError(failure)
      if (error.code === 'bad_request') {
        const fields = badRequestFields(error.message)
        if (fields === null) {
          notify('error', `保存失败：${error.message}`)
        } else {
          setServerErrors(fields)
        }
      } else {
        notify('error', saveFailureText(error))
      }
    } finally {
      writeInFlight.current = false
      setSaving(false)
    }
  }

  async function handleServiceTask(task: ServiceTask) {
    if (writeInFlight.current || serviceTask !== null) {
      return
    }
    writeInFlight.current = true
    setServiceTask(task)
    try {
      if (task === 'install') {
        // 重新安装需要覆盖已有 unit，与 CLI 的 --force 对应
        await host.request('service.install', { force: true })
      } else {
        await host.request('service.uninstall')
      }
      setUninstallOpen(false)
      reloadStatus()
      notify('success', task === 'install' ? '服务已重新安装' : '服务已卸载')
    } catch (failure) {
      notify('error', serviceFailureText(normalizeHostError(failure)))
    } finally {
      writeInFlight.current = false
      setServiceTask(null)
    }
  }

  return (
    <>
      <PageHead
        title="设置"
        actions={
          <Button
            className={styles.saveButton}
            onClick={handleSave}
            disabled={saveDisabled}
            title={saveTitle}
          >
            {saving ? '保存中…' : '保存设置'}
          </Button>
        }
      />
      <PageBody>
        <div className={styles.settings}>
          <section className={styles.group}>
            <h2 className={styles.groupLabel}>连接</h2>
            <Card>
              {configError === null ? null : (
                <div className={styles.loadError} role="alert">
                  <span className={styles.loadErrorText}>读取配置失败：{configError.message}</span>
                  <Button
                    size="sm"
                    tone="secondary"
                    onClick={reloadConfig}
                    disabled={configState.loading}
                  >
                    {configState.loading ? '重试中…' : '重试'}
                  </Button>
                </div>
              )}
              <Field
                className={styles.fieldRow}
                label="监听地址"
                value={draft.listen}
                onChange={(value) => updateField('listen', value)}
                disabled={formDisabled}
                error={serverErrors.listen ?? listenError}
                placeholder={ready ? '127.0.0.1:8091' : loadingPlaceholder}
                mono
              />
              <Field
                className={styles.fieldRow}
                label="备份目录"
                value={draft.backupDir}
                onChange={(value) => updateField('backupDir', value)}
                disabled={formDisabled}
                error={serverErrors.backupDir ?? backupError}
                placeholder={ready ? '留空使用默认目录' : loadingPlaceholder}
                mono
              />
              <Field
                className={styles.fieldRow}
                label="API 地址"
                value={draft.apiOrigin}
                onChange={(value) => updateField('apiOrigin', value)}
                disabled={formDisabled}
                error={serverErrors.apiOrigin ?? apiError}
                placeholder={ready ? 'https://api.deepseek.com' : loadingPlaceholder}
                mono
              />
            </Card>
          </section>

          <section className={styles.group}>
            <h2 className={styles.groupLabel}>外观</h2>
            <Card>
              <div className={`${styles.settingRow} ${styles.themeRow}`}>
                <span className={styles.settingLabel}>主题</span>
                <div className={`${styles.settingControl} ${styles.stacked}`}>
                  <Segmented
                    options={THEME_OPTIONS}
                    value={theme}
                    onChange={setChoice}
                    label="主题"
                    width={260}
                  />
                  <span className={styles.note}>跟随系统时，随操作系统切换浅色 / 深色。</span>
                </div>
              </div>
            </Card>
          </section>

          <section className={styles.group}>
            <h2 className={styles.groupLabel}>服务</h2>
            <Card>
              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>服务状态</span>
                <div className={styles.settingControl}>
                  <StatusPill status={serviceStatus} label={serviceStatusLabel} />
                </div>
              </div>
              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>管理方式</span>
                <span className={styles.monoValue}>systemd 用户单元</span>
              </div>
              <CardFooter
                end={
                  <>
                    <Button
                      tone="secondary"
                      onClick={() => {
                        void handleServiceTask('install')
                      }}
                      disabled={busy}
                    >
                      {serviceTask === 'install' ? '重新安装中…' : '重新安装'}
                    </Button>
                    <Button tone="danger" onClick={() => setUninstallOpen(true)} disabled={busy}>
                      {serviceTask === 'uninstall' ? '卸载中…' : '卸载服务'}
                    </Button>
                  </>
                }
              >
                {statusError === null ? '由 systemd 用户单元管理' : '无法读取服务状态'}
              </CardFooter>
            </Card>
          </section>

          <section className={styles.group}>
            <h2 className={styles.groupLabel}>关于</h2>
            <Card>
              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>版本</span>
                <span className={styles.monoValue}>{systemStatus?.version ?? '—'}</span>
              </div>
              <Field
                className={styles.fieldRow}
                label="数据目录"
                value={systemStatus?.dataDir ?? ''}
                readOnly
                mono
                placeholder={statusError === null ? '正在读取…' : '读取数据目录失败'}
              />
            </Card>
          </section>
        </div>

        {toast === null ? null : (
          <div className={styles.toastLayer}>
            <Toast tone={toast.tone}>{toast.message}</Toast>
          </div>
        )}

        <Dialog
          open={uninstallOpen}
          title="卸载服务？"
          description="将停止服务并删除 systemd 用户单元，已有配置与数据不会被删除。"
          onClose={serviceTask === 'uninstall' ? undefined : () => setUninstallOpen(false)}
          actions={
            <>
              <Button
                tone="secondary"
                onClick={() => setUninstallOpen(false)}
                disabled={serviceTask === 'uninstall'}
              >
                取消
              </Button>
              <Button
                tone="dangerSolid"
                onClick={() => {
                  void handleServiceTask('uninstall')
                }}
                disabled={serviceTask === 'uninstall'}
              >
                {serviceTask === 'uninstall' ? '卸载中…' : '卸载服务'}
              </Button>
            </>
          }
        >
          <p className={styles.dialogNote}>卸载后可通过「重新安装」恢复服务。</p>
        </Dialog>
      </PageBody>
    </>
  )
}
