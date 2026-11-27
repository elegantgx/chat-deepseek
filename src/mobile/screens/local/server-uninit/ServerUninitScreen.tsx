import { useState } from 'react'
import { useNavigate } from '../../../app/navigation.js'
import { useReady, useHost } from '../../../app/runtime.js'
import { useToast } from '../../../app/toast.js'
import { Button, Page, PageBody, TopBar } from '../../../ui/index.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import { ScreenNote } from '../shared/ScreenNote.js'
import { ServerStatusCard } from '../shared/ServerStatusCard.js'
import { SwitchServerRow } from '../shared/SwitchServerRow.js'
import { useAliveRef } from '../shared/useAliveRef.js'
import { useLocalServer } from '../shared/useLocalServer.js'
import type { AuthState } from '../shared/useLocalServer.js'

/**
 * 03 本机 · 未初始化（visual §7 #3）：灰点 + `初始化` + 一行说明 + 切换入口。
 *
 * “初始化”真正的写入是 `auth.setup`（创建第一个 Owner），那一步在创建账户页；
 * 这里先问 `auth.whoami`：已经初始化过就直接去完成页，否则进准备中。
 * 这样重复点初始化不会对着一个已有账户再走一遍创建表单。
 */
export const ServerUninitScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  const host = useHost()
  const ready = useReady()
  const { showToast } = useToast()
  const { status, config } = useLocalServer()
  const [busy, setBusy] = useState(false)
  const aliveRef = useAliveRef()

  // 端口只服从 service.status；config.listen 只在首帧还没拿到状态时垫位
  const listen = status?.listen ?? config?.listen ?? ''
  const version = config?.version ?? ready.version
  const dataDir = config?.dataDir ?? ready.dataDir

  const handleInit = async () => {
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
      // 失败不静默：留在本屏用 toast 说明，按钮恢复可点
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
        onBack={() => navigate('server-picker', { from: 'server-uninit' })}
      />
      <PageBody pad="server">
        <ServerStatusCard
          tone="idle"
          title={t.uninitialized}
          listen={listen}
          version={version}
          dataDir={dataDir}
          actions={
            <Button variant="primary" loading={busy} onClick={handleInit}>
              {t.init}
            </Button>
          }
        />
        <ScreenNote>{t.uninitNote}</ScreenNote>
        <SwitchServerRow from="server-uninit" />
      </PageBody>
    </Page>
  )
}
