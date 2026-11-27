import { useState } from 'react'
import { useNavigate, useRoute } from '../../../app/navigation.js'
import { useHost, useReady } from '../../../app/runtime.js'
import { useToast } from '../../../app/toast.js'
import { Button, Page, PageBody, Steps, TopBar } from '../../../ui/index.js'
import type { StepItem } from '../../../ui/index.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import { ScreenNote } from '../shared/ScreenNote.js'
import { ServerStatusCard } from '../shared/ServerStatusCard.js'
import { SwitchServerRow } from '../shared/SwitchServerRow.js'
import { useAliveRef } from '../shared/useAliveRef.js'
import { useLocalServer } from '../shared/useLocalServer.js'
import type { AuthState } from '../shared/useLocalServer.js'

/**
 * 05 本机 · 初始化失败（visual §7 #5）：红点 + 失败原因红字 + `重试`，
 * 步骤条第 1 步红叉，后面两步退回待办。
 *
 * 失败原因来自路由参数 `reason`：ipc v1 没有“上一次初始化错误”的投影，
 * 谁把用户带到这里，谁就把错误原文带过来；直接打开本屏时用示意的默认原因垫底。
 * 重试先问 `auth.whoami`，确认上次是否其实已经成功，再决定回准备中还是完成页。
 */
export const ServerFailedScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  const route = useRoute()
  const host = useHost()
  const ready = useReady()
  const { showToast } = useToast()
  const { status, config } = useLocalServer()
  const [busy, setBusy] = useState(false)
  const aliveRef = useAliveRef()

  const listen = status?.listen ?? config?.listen ?? ''
  const version = config?.version ?? ready.version
  const dataDir = config?.dataDir ?? ready.dataDir
  const reason = route.params.get('reason') ?? t.failedReason

  const steps: StepItem[] = [
    { label: t.stepCreateDir, state: 'failed' },
    { label: t.stepInitDb, state: 'pending' },
    { label: t.stepCreateAccount, state: 'pending' },
  ]

  const handleRetry = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const auth = (await host.request('auth.whoami')) as AuthState
      if (!aliveRef.current) {
        return
      }
      navigate(auth.initialized ? 'server-ready' : 'server-preparing')
    } catch {
      if (aliveRef.current) {
        showToast(t.actionFailed)
      }
    } finally {
      if (aliveRef.current) {
        setBusy(false)
      }
    }
  }

  return (
    <Page>
      <TopBar
        title={t.localTitle}
        onBack={() => navigate('server-picker', { from: 'server-failed' })}
      />
      <PageBody pad="server">
        <ServerStatusCard
          tone="failed"
          title={t.setupFailed}
          listen={listen}
          version={version}
          dataDir={dataDir}
          actions={
            <Button variant="primary" loading={busy} onClick={handleRetry}>
              {t.retry}
            </Button>
          }
        />
        <ScreenNote danger>{reason}</ScreenNote>
        <Steps items={steps} />
        <SwitchServerRow from="server-failed" />
      </PageBody>
    </Page>
  )
}
