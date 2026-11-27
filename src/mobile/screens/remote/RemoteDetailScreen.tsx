import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useRoute } from '../../app/navigation.js'
import { useHost, useIsMock, useReady } from '../../app/runtime.js'
import { getMe } from '../../../services/api/server.js'
import {
  Button,
  Card,
  KvList,
  KvRow,
  LinkStatus,
  ListRow,
  Page,
  PageBody,
  Pill,
  StatusActions,
  StatusHead,
  SwapIcon,
  TopBar,
} from '../../ui/index.js'
import { probeRemote, useRemoteServers, type ProbeOutcome } from './data.js'
import { useRemoteStrings } from './strings.js'
import styles from './RemoteDetailScreen.module.css'

/**
 * 18 远程详情 / 19 连接断开，外加「连接中」「证书不受信任」两个内部状态。
 *
 * 状态屏不是独立路由（visual §7.1）：19 只是首帧强制为 offline，用户点「重连」后
 * 同一个组件走 connecting → connected/offline/cert，不额外压一层历史记录。
 * 版本和账户都来自真实结果：版本取 `shell.servers.probe`，账户取 `/api/v1/auth/me`；
 * 拿不到账户时显示「未登录」，不伪造用户名。
 */

type Phase = 'connecting' | 'connected' | 'offline' | 'cert'

type FailureKind = 'network' | 'http' | 'protocol' | 'unknown'

interface Failure {
  kind: FailureKind
  status?: number
}

const reasonText = (failure: Failure, text: ReturnType<typeof useRemoteStrings>): string => {
  switch (failure.kind) {
    case 'http':
      return typeof failure.status === 'number'
        ? text.httpReason.replace('{status}', String(failure.status))
        : text.offlineReason
    case 'protocol':
      return text.protocolReason
    default:
      return text.offlineReason
  }
}

export const RemoteDetailScreen = () => {
  const route = useRoute()
  const ready = useReady()
  const host = useHost()
  const mock = useIsMock()
  const navigate = useNavigate()
  const text = useRemoteStrings()
  const { servers, selectedId } = useRemoteServers()

  const paramId = route.params.get('serverId')
  // 带参数时必须命中那一台；参数过期就显示空态，不要拿另一台的地址/版本冒充。
  const server = paramId
    ? servers.find((item) => item.kind === 'remote' && item.id === paramId)
    : (servers.find((item) => item.kind === 'remote' && item.id === selectedId) ??
      servers.find((item) => item.kind === 'remote'))

  const initialPhase: Phase =
    route.screen === 'server-remote-detail-offline'
      ? 'offline'
      : route.params.get('error') === 'tls'
        ? 'cert'
        : mock
          ? 'connected'
          : 'connecting'
  // 假场景没有 shell.servers.probe；预览直接按启动上下文展示已连接，真壳才探测。
  const shouldProbe = !mock && initialPhase === 'connecting'

  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [version, setVersion] = useState(ready.version)
  const [account, setAccount] = useState('')
  const [failure, setFailure] = useState<Failure>({ kind: 'network' })

  // 路由 id 在两个状态屏之间切换时，同一个组件实例要跟着重置首帧状态。
  useEffect(() => {
    setPhase(initialPhase)
  }, [initialPhase])

  const serverId = server?.id ?? ''
  const serverBaseUrl = server?.baseUrl ?? ''

  // 账户只能从当前选中服务器的会话里读；路由指向另一台时不能拿错服务器的登录态。
  useEffect(() => {
    if (!serverId || serverId !== selectedId) {
      return
    }
    let cancelled = false
    void getMe()
      .then((session) => {
        if (!cancelled && session) {
          setAccount(session.user.username)
        }
      })
      .catch(() => {
        // 离线或未登录时保持「未登录」，详情页不因为账户探测失败再报一次错。
      })
    return () => {
      cancelled = true
    }
  }, [serverId, selectedId])

  const applyProbe = useCallback(
    (result: ProbeOutcome) => {
      if (result.ok) {
        setVersion(result.version || ready.version)
        setPhase('connected')
        return
      }
      if (result.failure === 'tls') {
        setPhase('cert')
        return
      }
      setFailure({
        kind: result.failure === 'unknown' ? 'network' : result.failure,
        ...(result.status !== undefined ? { status: result.status } : {}),
      })
      setPhase('offline')
    },
    [ready.version]
  )

  useEffect(() => {
    if (!shouldProbe || !serverBaseUrl) {
      return
    }
    let cancelled = false
    setPhase('connecting')
    void probeRemote(host, serverBaseUrl).then((result) => {
      if (!cancelled) {
        applyProbe(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [shouldProbe, serverBaseUrl, host, applyProbe])

  const retry = async () => {
    if (!serverBaseUrl || phase === 'connecting') {
      return
    }
    setPhase('connecting')
    const result = await probeRemote(host, serverBaseUrl)
    applyProbe(result)
  }

  const goBack = () => navigate('server-picker')

  if (!server) {
    return (
      <Page tone="group">
        <TopBar title={text.detailTitle} onBack={goBack} />
        <PageBody pad="server">
          <Card padding="status">
            <p className={styles.missingText}>{text.noRemoteServer}</p>
            <StatusActions>
              <Button onClick={() => navigate('server-remote-add')}>{text.addServer}</Button>
            </StatusActions>
          </Card>
        </PageBody>
      </Page>
    )
  }

  const reason =
    phase === 'offline' ? reasonText(failure, text) : phase === 'cert' ? text.certReason : null

  return (
    <Page tone="group">
      <TopBar title={text.detailTitle} onBack={goBack} />
      <PageBody pad="server">
        <Card padding="status">
          <StatusHead
            tone={phase === 'connected' ? 'ok' : phase === 'connecting' ? 'busy' : 'failed'}
            pill={<Pill tone="muted">{text.pillRemote}</Pill>}
          >
            {phase === 'connected'
              ? text.connected
              : phase === 'connecting'
                ? text.connecting
                : phase === 'cert'
                  ? text.cert
                  : text.offline}
          </StatusHead>

          <KvList>
            <KvRow label={text.address} value={server.baseUrl} />
            {/* 离线时版本没有意义，按示意隐藏，避免显示上一次的旧值 */}
            {phase === 'connected' ? (
              <KvRow label={text.version} value={version || ready.version} />
            ) : null}
            <KvRow label={text.account} value={account || text.accountUnknown} mono={false} />
            {phase === 'connecting' ? (
              <LinkStatus tone="connecting">{text.connectingInfo}</LinkStatus>
            ) : null}
          </KvList>

          {phase === 'connected' ? null : (
            <StatusActions>
              <Button loading={phase === 'connecting'} onClick={() => void retry()}>
                {phase === 'connecting' ? text.connectingButton : text.reconnect}
              </Button>
            </StatusActions>
          )}
        </Card>

        {reason ? (
          <p
            className={`${styles.note}${phase === 'offline' || phase === 'cert' ? ` ${styles.dangerNote}` : ''}`}
          >
            {reason}
          </p>
        ) : null}

        <Card standalone>
          <ListRow
            icon={<SwapIcon />}
            title={text.switchServer}
            showChevron
            onClick={() => navigate('server-picker')}
          />
        </Card>

        <p className={styles.note}>{text.detailFooter}</p>
      </PageBody>
    </Page>
  )
}
