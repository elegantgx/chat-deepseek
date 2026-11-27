import { useState } from 'react'
import { useNavigate } from '../../../app/navigation.js'
import { useHost, useReady } from '../../../app/runtime.js'
import { useToast } from '../../../app/toast.js'
import { Button, Page, PageBody, TopBar } from '../../../ui/index.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import { MaintenanceGroup } from '../shared/MaintenanceGroup.js'
import { ScreenNote } from '../shared/ScreenNote.js'
import { ServerStatusCard } from '../shared/ServerStatusCard.js'
import { SwitchServerRow } from '../shared/SwitchServerRow.js'
import { useAliveRef } from '../shared/useAliveRef.js'
import { useLocalServer, waitForServiceSettle } from '../shared/useLocalServer.js'

/**
 * 09 本机 · 已停止（visual §7 #9）：灰点 + `启动服务`，维护组与切换入口出现。
 *
 * 启动真的走 `service.start`；返回 `starting` 时端口还没就绪，按桌面端同一套
 * 轮询到 running/stopped，再进运行中页。失败留在本屏并刷新状态，不静默。
 */
export const ServerStoppedScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  const host = useHost()
  const ready = useReady()
  const { showToast } = useToast()
  const { status, config, role, accountTotal, backupCount, error, refresh } = useLocalServer({
    maintenance: true,
  })
  const [busy, setBusy] = useState(false)
  const aliveRef = useAliveRef()

  const unavailable = error !== null
  const listen = status?.listen ?? config?.listen ?? ''
  const version = config?.version ?? ready.version
  const dataDir = config?.dataDir ?? ready.dataDir

  const handleStart = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const result = (await host.request('service.start')) as { state: 'running' | 'starting' }
      if (result.state === 'starting') {
        await waitForServiceSettle(host)
      }
      if (!aliveRef.current) {
        return
      }
      navigate('server-local')
    } catch {
      if (aliveRef.current) {
        showToast(t.actionFailed)
        // 启动可能已经部分生效（例如返回超时），用真实状态覆盖按钮判断
        void refresh()
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
        onBack={() => navigate('server-picker', { from: 'server-stopped' })}
      />
      <PageBody pad="server">
        <ServerStatusCard
          tone={unavailable ? 'failed' : 'idle'}
          title={unavailable ? t.unknown : t.stopped}
          listen={listen}
          version={version}
          dataDir={dataDir}
          actions={
            unavailable ? (
              <Button variant="primary" onClick={() => void refresh()}>
                {t.retry}
              </Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={handleStart}>
                {t.startService}
              </Button>
            )
          }
        />
        <ScreenNote>{t.stoppedNote}</ScreenNote>
        <MaintenanceGroup
          role={role}
          accountTotal={accountTotal}
          backupCount={backupCount}
          from="server-stopped"
          gap={24}
        />
        <SwitchServerRow from="server-stopped" />
      </PageBody>
    </Page>
  )
}
