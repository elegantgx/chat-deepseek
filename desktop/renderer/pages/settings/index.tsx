import { useEffect, useRef, useState } from 'react'
import { PageBody, PageHead, useTheme } from '../../app'
import type { ThemeChoice } from '../../app'
import type { ConfigProjection } from '../../app/ipc-types'
import { Button, Card, CardFooter, Dialog, Field, Segmented, StatusPill, Toast } from '../../ui'
import type { SegmentedOption, StatusKind, ToastTone } from '../../ui'
import { configFixture, serviceFixture, systemStatusFixture } from './fixtures'
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

/**
 * hash 尾巴给截图和人工验收钉初始状态：
 * `#settings` 默认、`#settings-dirty` 改动后、`#settings-dark` 深色（由外壳处理）。
 * `occupied` / `unwritable` 是本地失败样本，用来验证 Toast 与表单错误。
 */
function initialConfigFromHash(): ConfigProjection {
  const hash = window.location.hash.toLowerCase()
  if (hash.includes('unwritable')) {
    return {
      ...configFixture,
      listen: '127.0.0.1:8092',
      backupDir: '/proc/chat-deepseek/backups',
    }
  }
  if (hash.includes('occupied')) {
    return { ...configFixture, listen: '127.0.0.1:8090' }
  }
  if (hash.includes('dirty')) {
    return { ...configFixture, listen: '127.0.0.1:8092' }
  }
  return configFixture
}

/**
 * 样本阶段没有后端：用两个可预期的输入演示失败 Toast（8090 是本仓库前端 dev 端口，
 * /proc 不可写）。接上 `config.set` 后删掉这段，失败改由 ipc 错误返回。
 */
function simulatedFailure(config: ConfigProjection): string | undefined {
  if (config.listen.endsWith(':8090')) {
    return '监听地址已被占用'
  }
  if (config.backupDir === '/proc' || config.backupDir.startsWith('/proc/')) {
    return '配置目录不可写'
  }
  return undefined
}

export function SettingsPage() {
  const { choice: theme, setChoice } = useTheme()
  const [initial] = useState<ConfigProjection>(initialConfigFromHash)
  const [saved, setSaved] = useState<ConfigProjection>(configFixture)
  const [listen, setListen] = useState(initial.listen)
  const [backupDir, setBackupDir] = useState(initial.backupDir)
  const [apiOrigin, setApiOrigin] = useState(initial.apiOrigin)
  const [savedTheme, setSavedTheme] = useState<ThemeChoice>(theme)

  const [saving, setSaving] = useState(false)
  const [serviceInstalled, setServiceInstalled] = useState<boolean>(serviceFixture.installed)
  const [serviceTask, setServiceTask] = useState<ServiceTask | null>(null)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const timers = useRef<number[]>([])

  // 页面卸载时清掉模拟请求的定时器，避免回到已卸载的组件里 setState
  useEffect(() => {
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id))
      timers.current = []
    }
  }, [])

  // Toast 不阻塞操作，3 秒后自行消失（组件本身不带定时器）
  useEffect(() => {
    if (toast === null) {
      return
    }
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  function after(ms: number, task: () => void) {
    const id = window.setTimeout(() => {
      timers.current = timers.current.filter((timer) => timer !== id)
      task()
    }, ms)
    timers.current.push(id)
  }

  function notify(tone: ToastTone, message: string) {
    setToast({ tone, message })
  }

  const listenError = validateListen(listen)
  const backupError = validateBackupDir(backupDir)
  const apiError = validateApiOrigin(apiOrigin)
  const hasErrors = listenError !== undefined || backupError !== undefined || apiError !== undefined

  const dirty =
    listen !== saved.listen ||
    backupDir !== saved.backupDir ||
    apiOrigin !== saved.apiOrigin ||
    theme !== savedTheme
  const busy = saving || serviceTask !== null

  const serviceRunning = serviceInstalled && systemStatusFixture.service.state === 'running'
  const serviceStatus: StatusKind = serviceRunning ? 'running' : 'stopped'
  const serviceStatusLabel = serviceInstalled
    ? serviceRunning
      ? '已安装 · 运行中'
      : '已安装 · 已停止'
    : '未安装'

  function handleSave() {
    if (!dirty || hasErrors || busy) {
      return
    }
    setSaving(true)
    after(600, () => {
      const next: ConfigProjection = {
        ...saved,
        listen: listen.trim(),
        backupDir: backupDir.trim(),
        apiOrigin: apiOrigin.trim(),
      }
      const failure = simulatedFailure(next)
      setSaving(false)
      if (failure !== undefined) {
        notify('error', failure)
        return
      }
      setSaved(next)
      setListen(next.listen)
      setBackupDir(next.backupDir)
      setApiOrigin(next.apiOrigin)
      setSavedTheme(theme)
      notify('success', '设置已保存')
    })
  }

  function handleReinstall() {
    if (busy) {
      return
    }
    setServiceTask('install')
    after(600, () => {
      setServiceInstalled(true)
      setServiceTask(null)
      notify('success', '服务已重新安装')
    })
  }

  function handleUninstall() {
    if (busy) {
      return
    }
    setServiceTask('uninstall')
    after(600, () => {
      setServiceInstalled(false)
      setServiceTask(null)
      setUninstallOpen(false)
      notify('success', '服务已卸载')
    })
  }

  return (
    <>
      <PageHead
        title="设置"
        actions={
          <Button
            className={styles.saveButton}
            onClick={handleSave}
            disabled={!dirty || hasErrors || busy}
            title={dirty ? undefined : '没有未保存的更改'}
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
              <Field
                className={styles.fieldRow}
                label="监听地址"
                value={listen}
                onChange={setListen}
                disabled={saving}
                error={listenError}
                placeholder="127.0.0.1:8091"
                mono
              />
              <Field
                className={styles.fieldRow}
                label="备份目录"
                value={backupDir}
                onChange={setBackupDir}
                disabled={saving}
                error={backupError}
                placeholder="~/chat-deepseek/data/backups"
                mono
              />
              <Field
                className={styles.fieldRow}
                label="API 地址"
                value={apiOrigin}
                onChange={setApiOrigin}
                disabled={saving}
                error={apiError}
                placeholder="https://api.deepseek.com"
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
                <span className={styles.settingLabel}>服务单元</span>
                <span
                  className={styles.monoValue}
                  title={serviceInstalled ? serviceFixture.unitPath : undefined}
                >
                  {serviceInstalled ? serviceFixture.unitPath : '服务单元已移除'}
                </span>
              </div>
              <CardFooter
                end={
                  <>
                    <Button tone="secondary" onClick={handleReinstall} disabled={busy}>
                      {serviceTask === 'install' ? '重新安装中…' : '重新安装'}
                    </Button>
                    <Button
                      tone="danger"
                      onClick={() => setUninstallOpen(true)}
                      disabled={!serviceInstalled || busy}
                    >
                      {serviceTask === 'uninstall' ? '卸载中…' : '卸载服务'}
                    </Button>
                  </>
                }
              >
                {serviceInstalled ? '由 systemd 用户单元管理' : '服务未安装，可重新安装'}
              </CardFooter>
            </Card>
          </section>

          <section className={styles.group}>
            <h2 className={styles.groupLabel}>关于</h2>
            <Card>
              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>版本</span>
                <span className={styles.monoValue}>{systemStatusFixture.version}</span>
              </div>
              <Field
                className={styles.fieldRow}
                label="数据目录"
                value={systemStatusFixture.dataDir}
                readOnly
                mono
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
                onClick={handleUninstall}
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
