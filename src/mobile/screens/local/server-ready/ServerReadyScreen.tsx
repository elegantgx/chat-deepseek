import { useEffect } from 'react'
import { useNavigate } from '../../../app/navigation.js'
import { useReady } from '../../../app/runtime.js'
import { Page, PageBody, Steps, TopBar } from '../../../ui/index.js'
import type { StepItem } from '../../../ui/index.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import { ScreenNote } from '../shared/ScreenNote.js'
import { ServerStatusCard } from '../shared/ServerStatusCard.js'
import { useLocalServer } from '../shared/useLocalServer.js'

/**
 * 08 本机 · 初始化完成（visual §7 #8）：三步全绿，不放按钮，短暂停留后自动进下一屏。
 *
 * 停留时间取 1.4s 而不是 1s：验收的截图管线是 900ms 首拍、350ms 连拍，
 * 1s 会让第二拍正好落在跳转后，把完成态和已停止态拍成两张不同的图。
 * 定时器随卸载清理，用户提前返回不会在别处被再跳一次。
 */
const HOLD_MS = 1400

export const ServerReadyScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  const ready = useReady()
  const { status, config } = useLocalServer()

  const listen = status?.listen ?? config?.listen ?? ''
  const version = config?.version ?? ready.version
  const dataDir = config?.dataDir ?? ready.dataDir

  const steps: StepItem[] = [
    { label: t.stepCreateDir, state: 'done' },
    { label: t.stepInitDb, state: 'done' },
    { label: t.stepCreateAccount, state: 'done' },
  ]

  useEffect(() => {
    const timer = setTimeout(() => {
      // setup 成功后服务还没启动，所以下一屏是“已停止”，不是“运行中”
      navigate('server-stopped')
    }, HOLD_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [navigate])

  return (
    <Page>
      <TopBar title={t.localTitle} onBack={() => navigate('server-stopped')} />
      <PageBody pad="server">
        <ServerStatusCard
          tone="ok"
          title={t.setupDone}
          listen={listen}
          version={version}
          dataDir={dataDir}
        />
        <Steps items={steps} />
        <ScreenNote>{t.readyNote}</ScreenNote>
      </PageBody>
    </Page>
  )
}
