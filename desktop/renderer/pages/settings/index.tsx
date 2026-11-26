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
import { validateApiOrigin, validateBackupDir, validateDataDir, validateListen } from './validation'

/** 连接方式只是本地选择：SSH 未实现，选中它只提示并保持 local，不写 config。 */
type ConnectionMode = 'local' | 'ssh'

const CONNECTION_OPTIONS: ReadonlyArray<SegmentedOption<ConnectionMode>> = [
  { value: 'local', label: '本地' },
  { value: 'ssh', label: 'SSH' },
]

const THEME_OPTIONS: ReadonlyArray<SegmentedOption<ThemeChoice>> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

interface ToastState {
  tone: ToastTone
  message: string
}

type ServiceTask = 'install' | 'reinstall' | 'uninstall'
type ConfigField = 'listen' | 'backupDir' | 'apiOrigin' | 'dataDir'
type Draft = Record<'listen' | 'backupDir' | 'apiOrigin', string>
type FieldErrors = Partial<Record<ConfigField, string>>

interface ConfigPatch {
  listen?: string
  backupDir?: string
  apiOrigin?: string
}

/**
 * 主进程 `desktop.dataDir` / `desktop.dataDir.set` 的返回，契约在 `desktop/main.ts`。
 * 数据目录是启动参数，不属于 `ipc-types.ts` 里的 ipc 投影。
 */
interface DataDirState {
  current: string
  saved: string
  envOverride: string | null
  restartRequired: boolean
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
    case 'dataDir':
      return { ...errors, dataDir: undefined }
  }
}

/** 配置与数据目录是两个独立写入，失败文案必须点名是哪一项。 */
function saveFailureText(error: HostError): string {
  return `配置保存失败：${error.message || error.code}`
}

function dataDirFailureText(error: HostError): string {
  if (error.code === 'unavailable') {
    // 环境变量覆盖属于既定原因，原样展示后端文案。
    return error.message
  }
  return `数据目录保存失败：${error.message || error.code}`
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
  const dataDirState = useRequest<DataDirState>('desktop.dataDir')
  const config = configState.data
  const configError = configState.error
  const systemStatus = statusState.data
  const statusError = statusState.error
  const dataDirInfo = dataDirState.data
  const reloadConfig = configState.reload
  const reloadStatus = statusState.reload
  const reloadDataDir = dataDirState.reload

  const [baseline, setBaseline] = useState<ConfigProjection | null>(null)
  const [draft, setDraft] = useState<Draft>({ listen: '', backupDir: '', apiOrigin: '' })
  const [dataDirDraft, setDataDirDraft] = useState('')
  const [dataDirBaseline, setDataDirBaseline] = useState<string | null>(null)
  const [dataDirRestartRequired, setDataDirRestartRequired] = useState(false)
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [serviceTask, setServiceTask] = useState<ServiceTask | null>(null)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  /** 滚动条只在翻页时出现，见 settings.module.css 的 .scrolling */
  const [scrolling, setScrolling] = useState(false)
  /** state 要下次渲染才生效，双击时用 ref 挡住第二个写请求 */
  const writeInFlight = useRef(false)
  /** 滚动停止计时器：连续滚动时不断后推，停稳 800ms 后才淡出 */
  const scrollEndTimer = useRef<number | null>(null)

  // config.get 回来后才允许编辑：加载中与读取失败时表单保持空值 + 禁用。
  useEffect(() => {
    if (config === null) {
      return
    }
    setBaseline(config)
    setDraft(draftFrom(config))
    setServerErrors({})
  }, [config])

  // 数据目录也等主进程返回后再初始化；读失败时保持空值 + 禁用，不拿假路径顶替。
  useEffect(() => {
    if (dataDirInfo === null) {
      return
    }
    const initial = dataDirInfo.saved || dataDirInfo.current
    setDataDirBaseline(initial)
    setDataDirDraft(initial)
    setDataDirRestartRequired(dataDirInfo.restartRequired)
  }, [dataDirInfo])

  // Toast 不阻塞操作，3 秒后自行消失（组件本身不带定时器）
  useEffect(() => {
    if (toast === null) {
      return
    }
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  // 页面卸载时停掉淡出计时器，避免 setState 落到已卸载的组件上
  useEffect(() => {
    return () => {
      if (scrollEndTimer.current !== null) {
        window.clearTimeout(scrollEndTimer.current)
      }
    }
  }, [])

  const ready = baseline !== null
  const listenError = ready ? validateListen(draft.listen) : undefined
  const backupError = ready ? validateBackupDir(draft.backupDir) : undefined
  const apiError = ready ? validateApiOrigin(draft.apiOrigin) : undefined
  // 环境变量覆盖时输入框禁用；这时不校验也不允许写，避免让用户白改一遍。
  const dataDirEnvOverride = dataDirInfo?.envOverride ?? null
  const dataDirEditable = dataDirInfo !== null && dataDirEnvOverride === null
  const dataDirError = dataDirEditable ? validateDataDir(dataDirDraft) : undefined
  const dataDirChanged =
    dataDirEditable && dataDirBaseline !== null && dataDirDraft.trim() !== dataDirBaseline
  const hasErrors = Boolean(
    listenError ||
    backupError ||
    apiError ||
    dataDirError ||
    serverErrors.listen ||
    serverErrors.backupDir ||
    serverErrors.apiOrigin ||
    serverErrors.dataDir
  )
  const patch = baseline === null ? null : changedFields(baseline, draft)
  const dirty = patch !== null || dataDirChanged
  const busy = saving || serviceTask !== null
  const formDisabled = !ready || busy || configState.loading
  const dataDirDisabled = formDisabled || !dataDirEditable || dataDirState.loading
  const saveDisabled = !ready || busy || configState.loading || !dirty || hasErrors

  const service = systemStatus?.service
  // 本地运行不需要 unit：状态 pill 只看 TCP 探测结果，不再用 installed 推「未安装」。
  const serviceState = service?.state
  const serviceStatus: StatusKind =
    systemStatus === null
      ? 'stopped'
      : serviceState === 'running'
        ? 'running'
        : serviceState === 'stopped'
          ? 'stopped'
          : 'error'
  const serviceStatusLabel =
    systemStatus === null
      ? statusError === null
        ? '读取中…'
        : '状态不可用'
      : serviceState === 'running'
        ? '运行中'
        : serviceState === 'stopped'
          ? '已停止'
          : '状态未知'
  // mode 与 state 正交：它回答「谁来托管」，不代表跑没跑（none 才是真没在跑）。
  const serviceMode = service?.mode
  const serviceModeLabel =
    serviceMode === 'process'
      ? '桌面端本地进程'
      : serviceMode === 'systemd'
        ? 'systemd 用户单元'
        : serviceMode === 'none'
          ? '未运行'
          : '—'
  // 字段缺席只可能是旧后端：按「已安装、平台支持」降级，避免把老数据当成未安装。
  const serviceSupported = service?.supported !== false
  const serviceInstalled = service?.installed !== false
  // 状态还没回来时不知道 unit 装没装，不能先给「安装」或「重新安装」。
  const serviceReady = systemStatus !== null
  // 安装单元只是可选的「开机自启 + 脱离桌面端」，本地进程模式本来就不需要它。
  const serviceFooter =
    statusError !== null
      ? '无法读取服务状态'
      : systemStatus === null
        ? '正在读取服务状态…'
        : serviceInstalled
          ? '由 systemd 用户单元管理'
          : '以桌面端本地进程运行，不需要 systemd；安装单元后由 systemd 管理并支持开机自启'
  const installTask: ServiceTask = serviceInstalled ? 'reinstall' : 'install'
  const installLabel =
    serviceTask === installTask
      ? serviceInstalled
        ? '重新安装中…'
        : '安装中…'
      : serviceInstalled
        ? '重新安装'
        : '安装为系统服务（开机自启）'

  const loadingPlaceholder = configError === null ? '正在读取配置…' : '读取配置失败'
  const dataDirPlaceholder =
    dataDirInfo !== null
      ? dataDirInfo.current
      : dataDirState.loading
        ? '正在读取…'
        : '读取数据目录失败'
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

  /** 滚动中给容器挂 .scrolling；计时器只在第一次滚动时创建，之后每次事件后推结束时间。 */
  function handleScroll() {
    if (scrollEndTimer.current === null) {
      setScrolling(true)
    } else {
      window.clearTimeout(scrollEndTimer.current)
    }
    scrollEndTimer.current = window.setTimeout(() => {
      scrollEndTimer.current = null
      setScrolling(false)
    }, 800)
  }

  function handleConnectionMode(mode: ConnectionMode) {
    if (mode === 'ssh') {
      notify('error', 'SSH 连接暂不支持，请使用本地连接')
    }
  }

  function updateField(field: 'listen' | 'backupDir' | 'apiOrigin', value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors((current) => clearFieldError(current, field))
  }

  function updateDataDir(value: string) {
    setDataDirDraft(value)
    setServerErrors((current) => clearFieldError(current, 'dataDir'))
  }

  async function handleSave() {
    if (writeInFlight.current || !ready || !dirty || hasErrors) {
      return
    }
    writeInFlight.current = true
    setSaving(true)
    setServerErrors({})

    /** 两个写入彼此独立：一个失败不影响另一个，提示里必须点名失败的是哪一个。 */
    const problems: string[] = []
    let failed = false
    let restartRequired = false

    try {
      if (patch !== null) {
        try {
          const result = (await host.request('config.set', patch)) as ConfigProjection
          setBaseline(result)
          setDraft(draftFrom(result))
        } catch (failure) {
          failed = true
          const error = normalizeHostError(failure)
          const fields = error.code === 'bad_request' ? badRequestFields(error.message) : null
          if (fields === null) {
            problems.push(saveFailureText(error))
          } else {
            setServerErrors(fields)
          }
        }
      }

      if (dataDirChanged) {
        try {
          const result = (await host.request('desktop.dataDir.set', {
            dataDir: dataDirDraft.trim(),
          })) as DataDirState
          const saved = result.saved || result.current
          setDataDirBaseline(saved)
          setDataDirDraft(saved)
          setDataDirRestartRequired(result.restartRequired)
          restartRequired = result.restartRequired
        } catch (failure) {
          failed = true
          const error = normalizeHostError(failure)
          if (error.code === 'bad_request' && error.message.startsWith('dataDir')) {
            setServerErrors({ dataDir: error.message })
          } else {
            problems.push(dataDirFailureText(error))
          }
        }
      }

      if (!failed) {
        notify('success', restartRequired ? '数据目录已保存，重启应用后生效' : '设置已保存')
      } else if (problems.length > 0) {
        notify('error', problems.join('；'))
      }
    } finally {
      writeInFlight.current = false
      setSaving(false)
    }
  }

  async function handleServiceTask(task: ServiceTask) {
    if (writeInFlight.current || serviceTask !== null || !serviceReady) {
      return
    }
    // 卸载只删 unit，不需要 platform 能力；安装/重装必须有 systemd。
    if (task !== 'uninstall' && !serviceSupported) {
      return
    }
    writeInFlight.current = true
    setServiceTask(task)
    try {
      if (task === 'uninstall') {
        await host.request('service.uninstall')
      } else if (task === 'reinstall') {
        // 重新安装需要覆盖已有 unit，与 CLI 的 --force 对应
        await host.request('service.install', { force: true })
      } else {
        // 首次安装不带 force，避免把「安装」写成隐式覆盖
        await host.request('service.install', {})
      }
      setUninstallOpen(false)
      reloadStatus()
      notify(
        'success',
        task === 'uninstall' ? '服务已卸载' : task === 'reinstall' ? '服务已重新安装' : '服务已安装'
      )
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
        <div
          className={scrolling ? `${styles.settings} ${styles.scrolling}` : styles.settings}
          onScroll={handleScroll}
        >
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
              <div className={`${styles.settingRow} ${styles.themeRow}`}>
                <span className={styles.settingLabel}>连接方式</span>
                <div className={`${styles.settingControl} ${styles.stacked}`}>
                  <Segmented
                    options={CONNECTION_OPTIONS}
                    value="local"
                    onChange={handleConnectionMode}
                    label="连接方式"
                    width={260}
                  />
                  <span className={styles.note}>SSH 连接方式暂未实现，当前只支持本机回环。</span>
                </div>
              </div>
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
              <Field
                className={styles.fieldRow}
                label="数据目录"
                value={dataDirDraft}
                onChange={updateDataDir}
                disabled={dataDirDisabled}
                error={serverErrors.dataDir ?? dataDirError}
                placeholder={dataDirPlaceholder}
                mono
              />
              {dataDirInfo === null && dataDirState.error !== null ? (
                <div className={styles.dataDirLoadError} role="alert">
                  <span className={styles.dataDirErrorText}>
                    读取数据目录失败：{dataDirState.error.message}
                  </span>
                  <Button
                    size="sm"
                    tone="secondary"
                    onClick={reloadDataDir}
                    disabled={dataDirState.loading}
                  >
                    {dataDirState.loading ? '重试中…' : '重试'}
                  </Button>
                </div>
              ) : (
                <div className={styles.dataDirNotes}>
                  {dataDirRestartRequired ? (
                    <p className={`${styles.dataDirNote} ${styles.dataDirWarn}`}>
                      已保存，重启应用后生效
                    </p>
                  ) : null}
                  <p className={styles.dataDirNote}>
                    {dataDirEnvOverride === null
                      ? '保存后不会立即切换；重启应用后才使用新目录。'
                      : '当前由环境变量 CHAT_DEEPSEEK_DATA_DIR 指定，界面不能修改'}
                  </p>
                </div>
              )}
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
                <span className={styles.modeValue}>{serviceModeLabel}</span>
              </div>
              {/* 已经装了 systemd 单元时，这行说明与当前管理方式无关，收起来避免自相矛盾 */}
              {serviceInstalled ? null : (
                <p className={styles.serviceNote}>
                  不安装 systemd 也能启动服务；安装单元只是让它开机自启、脱离桌面端运行。
                </p>
              )}
              {serviceSupported ? null : (
                <p className={`${styles.serviceNote} ${styles.serviceWarn}`}>
                  当前平台没有 systemd，无法安装为系统服务；本地运行不受影响。
                </p>
              )}
              <CardFooter
                end={
                  <>
                    <Button
                      tone="secondary"
                      onClick={() => {
                        void handleServiceTask(installTask)
                      }}
                      disabled={busy || !serviceSupported || !serviceReady}
                      title={
                        serviceSupported ? undefined : '当前平台没有 systemd，无法安装为系统服务'
                      }
                    >
                      {installLabel}
                    </Button>
                    {serviceReady && serviceInstalled ? (
                      <Button tone="danger" onClick={() => setUninstallOpen(true)} disabled={busy}>
                        {serviceTask === 'uninstall' ? '卸载中…' : '卸载服务'}
                      </Button>
                    ) : null}
                  </>
                }
              >
                {serviceFooter}
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
          <p className={styles.dialogNote}>卸载后可通过「安装为系统服务（开机自启）」重新安装。</p>
        </Dialog>
      </PageBody>
    </>
  )
}
