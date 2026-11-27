import { useEffect } from 'react'
import { useNavigate } from '../../../app/navigation.js'
import { useHost, useReady } from '../../../app/runtime.js'
import { useToast } from '../../../app/toast.js'
import { Button, Page, PageBody, Steps, TopBar } from '../../../ui/index.js'
import type { StepItem } from '../../../ui/index.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import { ScreenNote } from '../shared/ScreenNote.js'
import { ServerStatusCard } from '../shared/ServerStatusCard.js'
import { useLocalServer } from '../shared/useLocalServer.js'
import type { AuthState } from '../shared/useLocalServer.js'
import styles from './ServerPreparingScreen.module.css'

/**
 * 04 本机 · 准备中（visual §7 #4）：步骤条第 2 步进行中，主按钮不可点，
 * 不显示“切换或添加服务器”——初始化半途换服会留下坏状态（visual §8）。
 *
 * 真正创建数据库/Owner 的 `auth.setup` 在下一步的创建账户页；本屏先确认
 * 是否已经有活动 Owner：有就直接进完成页，没有就在一拍之后进创建账户页。
 * 定时器必须随卸载清理，否则用户返回后仍会被拽走。
 */
const HANDOFF_MS = 1400

export const ServerPreparingScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  const host = useHost()
  const ready = useReady()
  const { showToast } = useToast()
  const { status, config } = useLocalServer()

  const listen = status?.listen ?? config?.listen ?? ''
  const version = config?.version ?? ready.version
  const dataDir = config?.dataDir ?? ready.dataDir

  const steps: StepItem[] = [
    { label: t.stepCreateDir, state: 'done' },
    { label: t.stepInitDb, state: 'current' },
    { label: t.stepCreateAccount, state: 'pending' },
  ]

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const bootstrap = async () => {
      try {
        const auth = (await host.request('auth.whoami')) as AuthState
        if (cancelled) {
          return
        }
        if (auth.initialized) {
          navigate('server-ready')
          return
        }
        timer = setTimeout(() => {
          if (!cancelled) {
            navigate('account-create')
          }
        }, HANDOFF_MS)
      } catch {
        if (!cancelled) {
          showToast(t.actionFailed)
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [host, navigate, showToast, t.actionFailed])

  return (
    <Page>
      <TopBar title={t.localTitle} onBack={() => navigate('server-uninit')} />
      <PageBody pad="server">
        <ServerStatusCard
          tone="busy"
          title={t.preparing}
          listen={listen}
          version={version}
          dataDir={dataDir}
          actions={
            // 示意这一屏用灰底禁用，但 visual §5.1 与验收清单要求禁用主按钮保留品牌色 45%；
            // 灰底会被看成“这里本来就没有按钮”，所以按规范而不是按示意的那一处写。
            <Button variant="primary" disabled className={styles.initializingButton}>
              {t.initializing}
            </Button>
          }
        />
        <Steps items={steps} />
        <ScreenNote>{t.preparingNote}</ScreenNote>
      </PageBody>
    </Page>
  )
}
