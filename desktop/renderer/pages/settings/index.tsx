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
import type {
  ConfigProjection,
  ServiceInstallResult,
  ServiceStartResult,
  SystemStatus,
} from '../../app/ipc-types'
import {
  Button,
  Card,
  CardFooter,
  Dialog,
  Field,
  Segmented,
  StatusPill,
  TextButton,
  Toast,
  Toggle,
} from '../../ui'
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
  const [uninstallBusy, setUninstallBusy] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  /** 打开对话框时的安装/运行态：安装成功后状态会变，文案不能跟着跳成「更新」 */
  const [installWasInstalled, setInstallWasInstalled] = useState(false)
  const [installWasRunning, setInstallWasRunning] = useState(false)
  const [installEnable, setInstallEnable] = useState(true)
  const [installStart, setInstallStart] = useState(true)
  const [installBusy, setInstallBusy] = useState(false)
  const [installWarnings, setInstallWarnings] = useState<string[]>([])
  const [installError, setInstallError] = useState<string | null>(null)
  const [lingerCopied, setLingerCopied] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  /** 滚动条只在翻页时出现，见 settings.module.css 的 .scrolling */
  const [scrolling, setScrolling] = useState(false)
  /** state 要下次渲染才生效，双击时用 ref 挡住第二个写请求 */
  const writeInFlight = useRef(false)
  /** 滚动停止计时器：连续滚动时不断后推，停稳 800ms 后才淡出 */
  const scrollEndTimer = useRef<number | null>(null)
  /** 「已复制」1.5s 后恢复按钮文案 */
  const copyTimerRef = useRef<number | null>(null)

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
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
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
  const busy = saving || uninstallBusy || installBusy
  const formDisabled = !ready || busy || configState.loading
  const dataDirDisabled = formDisabled || !dataDirEditable || dataDirState.loading
  const saveDisabled = !ready || busy || configState.loading || !dirty || hasErrors

  const service = systemStatus?.service
  // 本地运行不需要 unit：状态 pill 只看 TCP 探测结果，不再用 installed 推「未安装」。
  const serviceState = service?.state
  const serviceRunning = serviceState === 'running'
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
  const installLabel = serviceInstalled ? '重新安装' : '安装为系统服务'
  // system.status 里没有用户名；拿不到就写 <user>，不猜当前登录账户。
  const lingerEnabled = service?.linger === true
  const lingerCommand = lingerEnabled
    ? 'loginctl disable-linger <user>'
    : 'loginctl enable-linger <user>'
  const installPrimaryLabel = installBusy
    ? installWasInstalled
      ? '更新中…'
      : '安装中…'
    : installWasInstalled
      ? '更新'
      : '安装'
  const installStartLabel =
    installWasInstalled && installWasRunning ? '更新后重启服务' : '安装后立即启动'
  // 安装完成且有 warning 时只留「关闭」，防止同一份结果被再点一次重复安装；
  // 出错时主按钮仍保留，让用户能原地重试。
  const installFinishedWithWarnings = installWarnings.length > 0 && installError === null

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

  function openInstallDialog() {
    if (busy || !serviceReady || !serviceSupported) {
      return
    }
    // 每次打开都回到契约默认值：开机自启与安装后启动都默认开
    setInstallWasInstalled(serviceInstalled)
    setInstallWasRunning(serviceRunning)
    setInstallEnable(true)
    setInstallStart(true)
    setInstallWarnings([])
    setInstallError(null)
    setLingerCopied(false)
    setInstallOpen(true)
  }

  function closeInstallDialog() {
    if (installBusy) {
      return
    }
    setInstallOpen(false)
  }

  /** file:// 下 navigator.clipboard 可能不可用，失败后回落到 execCommand('copy') */
  async function writeClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {
      // 权限被拒或不在安全上下文，交给下面的旧路径
    }
    try {
      const field = document.createElement('textarea')
      field.value = text
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.top = '0'
      field.style.opacity = '0'
      document.body.appendChild(field)
      try {
        field.select()
        return document.execCommand('copy')
      } finally {
        field.remove()
      }
    } catch {
      return false
    }
  }

  async function copyLingerCommand() {
    const copied = await writeClipboard(lingerCommand)
    if (!copied) {
      notify('error', '复制失败，请手动选择命令')
      return
    }
    setLingerCopied(true)
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null
      setLingerCopied(false)
    }, 1500)
  }

  /**
   * service.start 返回 starting 时端口/单元还没就绪；设置页没有服务页那套轮询，
   * 这里等一次探测落位再收尾，免得状态卡停在「状态未知」。
   */
  async function waitForServiceSettled(): Promise<void> {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      try {
        const next = (await host.request('system.status')) as SystemStatus
        if (next.service.state === 'running' || next.service.state === 'stopped') {
          return
        }
      } catch {
        // 读失败交给随后的 reloadStatus 展示错误，安装本身已经成功
        return
      }
    }
  }

  async function handleInstall() {
    if (writeInFlight.current || installBusy || !serviceReady || !serviceSupported) {
      return
    }
    writeInFlight.current = true
    setInstallBusy(true)
    setInstallError(null)
    setInstallWarnings([])
    try {
      const result = (await host.request('service.install', {
        force: serviceInstalled,
        enable: installEnable,
      })) as ServiceInstallResult
      const warnings = result.warnings ?? []
      setInstallWarnings(warnings)

      if (installStart) {
        // 正在运行时先停再起：安装 unit 后若仍留着本地子进程，service.start 会直接复用
        // 旧进程而不会切到 systemd；停止后再启动才会走新 unit。
        if (serviceRunning) {
          await host.request('service.stop')
        }
        const started = (await host.request('service.start')) as ServiceStartResult
        if (started.state === 'starting') {
          await waitForServiceSettled()
        }
      }

      // 有 warning 时对话框留着，让用户看完 linger 说明再手动关闭；成功本身照样给 Toast。
      notify('success', serviceInstalled ? '服务已更新' : '服务已安装')
      if (warnings.length === 0) {
        setInstallOpen(false)
      }
    } catch (failure) {
      setInstallError(serviceFailureText(normalizeHostError(failure)))
    } finally {
      reloadStatus()
      writeInFlight.current = false
      setInstallBusy(false)
    }
  }

  async function handleUninstall() {
    if (writeInFlight.current || uninstallBusy || !serviceReady) {
      return
    }
    writeInFlight.current = true
    setUninstallBusy(true)
    try {
      await host.request('service.uninstall')
      setUninstallOpen(false)
      reloadStatus()
      notify('success', '服务已卸载')
    } catch (failure) {
      notify('error', serviceFailureText(normalizeHostError(failure)))
    } finally {
      writeInFlight.current = false
      setUninstallBusy(false)
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
                      onClick={openInstallDialog}
                      disabled={busy || !serviceSupported || !serviceReady}
                      title={
                        serviceSupported ? undefined : '当前平台没有 systemd，无法安装为系统服务'
                      }
                    >
                      {installLabel}
                    </Button>
                    {serviceReady && serviceInstalled ? (
                      <Button tone="danger" onClick={() => setUninstallOpen(true)} disabled={busy}>
                        {uninstallBusy ? '卸载中…' : '卸载服务'}
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
          open={installOpen}
          title={installWasInstalled ? '重新安装系统服务' : '安装系统服务'}
          onClose={installBusy ? undefined : closeInstallDialog}
          actions={
            <>
              <Button tone="secondary" onClick={closeInstallDialog} disabled={installBusy}>
                {installFinishedWithWarnings ? '关闭' : '取消'}
              </Button>
              {installFinishedWithWarnings ? null : (
                <Button
                  onClick={() => {
                    void handleInstall()
                  }}
                  disabled={installBusy}
                >
                  {installPrimaryLabel}
                </Button>
              )}
            </>
          }
        >
          <div className={styles.installBody}>
            <dl className={styles.installMeta}>
              <div className={styles.installMetaRow}>
                <dt className={styles.installMetaLabel}>数据目录</dt>
                <dd className={styles.installMetaValue}>{systemStatus?.dataDir ?? '—'}</dd>
              </div>
              <div className={styles.installMetaRow}>
                <dt className={styles.installMetaLabel}>监听地址</dt>
                <dd className={styles.installMetaValue}>{service?.listen ?? '—'}</dd>
              </div>
            </dl>

            <div className={styles.installOptionRow}>
              <div className={styles.installOptionText}>
                <span className={styles.installOptionLabel}>开机自启</span>
                <span className={styles.installOptionHint}>
                  {installWasInstalled ? '重新安装会按此设置更新' : '安装后开机自动启动服务'}
                </span>
              </div>
              <Toggle
                checked={installEnable}
                onChange={setInstallEnable}
                label="开机自启"
                disabled={installBusy || installFinishedWithWarnings}
                className={styles.installToggle}
              />
            </div>

            <div className={styles.installOptionRow}>
              <div className={styles.installOptionText}>
                <span className={styles.installOptionLabel}>{installStartLabel}</span>
                <span className={styles.installOptionHint}>
                  {installWasInstalled && installWasRunning
                    ? '先停止再启动，确保新单元生效'
                    : '安装完成后启动服务'}
                </span>
              </div>
              <Toggle
                checked={installStart}
                onChange={setInstallStart}
                label={installStartLabel}
                disabled={installBusy || installFinishedWithWarnings}
                className={styles.installToggle}
              />
            </div>

            <div className={styles.lingerBlock}>
              <div className={styles.lingerHead}>
                <span className={styles.installOptionLabel}>linger</span>
                <span className={lingerEnabled ? styles.lingerOn : styles.lingerOff}>
                  {lingerEnabled ? '已开启（注销后服务继续运行）' : '未开启（注销后服务会停止）'}
                </span>
              </div>
              <div className={styles.lingerCommandRow}>
                <input
                  className={styles.lingerCommand}
                  value={lingerCommand}
                  readOnly
                  aria-label="linger 命令"
                />
                <TextButton
                  tone="quiet"
                  onClick={() => {
                    void copyLingerCommand()
                  }}
                  disabled={installBusy}
                >
                  {lingerCopied ? '已复制' : '复制'}
                </TextButton>
              </div>
            </div>

            {installError === null ? null : (
              <p className={styles.installError} role="alert">
                {installError}
              </p>
            )}

            {installWarnings.length === 0 ? null : (
              <div className={styles.installWarnings} role="status">
                <p className={styles.installWarningsTitle}>
                  {installWasInstalled ? '更新完成，但需要留意' : '安装完成，但需要留意'}
                </p>
                <ul className={styles.installWarningList}>
                  {installWarnings.map((warning, index) => (
                    <li key={`${index}-${warning}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Dialog>

        <Dialog
          open={uninstallOpen}
          title="卸载服务？"
          description="将停止服务并删除 systemd 用户单元，已有配置与数据不会被删除。"
          onClose={uninstallBusy ? undefined : () => setUninstallOpen(false)}
          actions={
            <>
              <Button
                tone="secondary"
                onClick={() => setUninstallOpen(false)}
                disabled={uninstallBusy}
              >
                取消
              </Button>
              <Button
                tone="dangerSolid"
                onClick={() => {
                  void handleUninstall()
                }}
                disabled={uninstallBusy}
              >
                {uninstallBusy ? '卸载中…' : '卸载服务'}
              </Button>
            </>
          }
        >
          <p className={styles.dialogNote}>卸载后可通过「安装为系统服务」重新安装。</p>
        </Dialog>
      </PageBody>
    </>
  )
}
