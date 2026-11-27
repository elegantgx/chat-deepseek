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
import { formatTemplate, listenHost } from '../shared/format.js'
import { useAliveRef } from '../shared/useAliveRef.js'
import { useLocalServer, waitForServiceSettle } from '../shared/useLocalServer.js'

/**
 * 10 本机 · 运行中（visual §7 #10）：绿点 + `重启` / `停止服务`，维护组完整。
 *
 * 主操作真的走 `service.restart` / `service.stop`；重启返回 starting 时轮询到端口就绪，
 * 停止成功后再进已停止屏。若本屏是被直接打开而实际服务已停，状态卡按真实状态
 * 退成“已停止 + 启动服务”，不画一个假的运行中。
 */
type Busy = 'restart' | 'stop' | 'start' | null

export const ServerLocalScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  const host = useHost()
  const ready = useReady()
  const { showToast } = useToast()
  const { status, config, role, accountTotal, backupCount, error, refresh } = useLocalServer({
    maintenance: true,
  })
  const [busy, setBusy] = useState<Busy>(null)
  const aliveRef = useAliveRef()

  // 状态还没回来时按本屏的语义画“运行中”，数据到了再以 service.status 为准；
  // 读失败则画“状态未知 + 重试”，不用一个假的运行中盖住错误
  const unavailable = error !== null
  const running = status?.state !== 'stopped'
  const listen = status?.listen ?? config?.listen ?? ''
  const version = config?.version ?? ready.version
  const dataDir = config?.dataDir ?? ready.dataDir

  // 说明里要一个主机名；状态还没回来时用壳给的 baseUrl 兜底（不写死地址，更不写死端口）
  const localBase = ready.servers.find((server) => server.kind === 'local')?.baseUrl ?? ''
  const noteHost = listenHost(listen) || listenHost(localBase.replace(/^https?:\/\//, '')) || '—'

  const handleRestart = async () => {
    if (busy !== null) {
      return
    }
    setBusy('restart')
    try {
      const result = (await host.request('service.restart')) as { state: 'running' | 'starting' }
      if (result.state === 'starting') {
        await waitForServiceSettle(host)
      }
      await refresh()
      if (!aliveRef.current) {
        return
      }
      showToast(t.restarted)
    } catch {
      if (aliveRef.current) {
        showToast(t.actionFailed)
        void refresh()
      }
    } finally {
      if (aliveRef.current) {
        setBusy(null)
      }
    }
  }

  const handleStop = async () => {
    if (busy !== null) {
      return
    }
    setBusy('stop')
    try {
      await host.request('service.stop')
      if (!aliveRef.current) {
        return
      }
      navigate('server-stopped')
    } catch {
      if (aliveRef.current) {
        showToast(t.actionFailed)
        void refresh()
      }
    } finally {
      if (aliveRef.current) {
        setBusy(null)
      }
    }
  }

  const handleStart = async () => {
    if (busy !== null) {
      return
    }
    setBusy('start')
    try {
      const result = (await host.request('service.start')) as { state: 'running' | 'starting' }
      if (result.state === 'starting') {
        await waitForServiceSettle(host)
      }
      await refresh()
      if (!aliveRef.current) {
        return
      }
      showToast(t.started)
    } catch {
      if (aliveRef.current) {
        showToast(t.actionFailed)
        void refresh()
      }
    } finally {
      if (aliveRef.current) {
        setBusy(null)
      }
    }
  }

  return (
    <Page>
      <TopBar
        title={t.localTitle}
        onBack={() => navigate('server-picker', { from: 'server-local' })}
      />
      <PageBody pad="server">
        <ServerStatusCard
          tone={unavailable ? 'failed' : running ? 'ok' : 'idle'}
          title={unavailable ? t.unknown : running ? t.running : t.stopped}
          listen={listen}
          version={version}
          dataDir={dataDir}
          actions={
            unavailable ? (
              <Button variant="primary" onClick={() => void refresh()}>
                {t.retry}
              </Button>
            ) : running ? (
              <>
                <Button
                  variant="secondary"
                  loading={busy === 'restart'}
                  disabled={busy !== null && busy !== 'restart'}
                  onClick={handleRestart}
                >
                  {t.restart}
                </Button>
                <Button
                  variant="danger"
                  loading={busy === 'stop'}
                  disabled={busy !== null && busy !== 'stop'}
                  onClick={handleStop}
                >
                  {t.stopService}
                </Button>
              </>
            ) : (
              <Button variant="primary" loading={busy === 'start'} onClick={handleStart}>
                {t.startService}
              </Button>
            )
          }
        />
        <MaintenanceGroup
          role={role}
          accountTotal={accountTotal}
          backupCount={backupCount}
          from="server-local"
          gap={28}
        />
        <SwitchServerRow from="server-local" />
        <ScreenNote>{formatTemplate(t.localNote, { host: noteHost })}</ScreenNote>
      </PageBody>
    </Page>
  )
}
