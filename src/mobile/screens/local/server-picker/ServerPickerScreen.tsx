import { useNavigate, useRoute } from '../../../app/navigation.js'
import { useReady } from '../../../app/runtime.js'
import {
  Badge,
  Button,
  Card,
  GlobeIcon,
  Page,
  PageBody,
  PhoneIcon,
  TopBar,
} from '../../../ui/index.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import { listenHost } from '../shared/format.js'
import { resolveFrom } from '../shared/navigation.js'
import { useLocalServer } from '../shared/useLocalServer.js'
import styles from './ServerPickerScreen.module.css'

/**
 * 02 切换或添加服务器（visual §7 #2）：本机 / 远程两卡。
 *
 * 卡里必须写清能力差异，所以“本机”卡带 App 自带后端、离线可用和当前地址，
 * “远程”卡带用户自己部署的说明和已保存的地址。状态点只在本机卡上反映真实服务状态；
 * 远程是否“已连接”由壳的 selectedId 决定（远程不走本机 service.status）。
 *
 * 整张卡的上半部分是按钮：当前服务器的按钮显示“当前使用中”且不可点，
 * 但卡片本身仍要能进对应的服务器页，否则从首启进到选择页就无路可走。
 */
export const ServerPickerScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  const route = useRoute()
  const ready = useReady()
  const { status, config, auth, error } = useLocalServer()
  const back = resolveFrom(route.params.get('from'), 'launch')

  const localServer = ready.servers.find((server) => server.kind === 'local')
  const remoteServer = ready.servers.find((server) => server.kind === 'remote')
  const localCurrent = localServer !== undefined && ready.selectedId === localServer.id
  const remoteCurrent = remoteServer !== undefined && ready.selectedId === remoteServer.id

  // 未初始化优先于服务状态：此时 service.status 只会是 stopped，但它说明不了“还没建账户”
  const notInitialized = auth?.initialized === false
  // 状态读失败时不能假装“运行中”；未初始化优先，因为那能解释为什么服务没起
  const localState = notInitialized
    ? t.uninitialized
    : error !== null
      ? t.unknown
      : status?.state === 'stopped'
        ? t.stopped
        : status?.state === 'unknown'
          ? t.unknown
          : t.running
  const localRunning =
    !notInitialized && error === null && (status === null || status.state === 'running')

  // 端口只从 service.status.listen 取；config.listen 只在首帧状态还没回来时垫一下
  const host = listenHost(status?.listen ?? config?.listen ?? '')
  const localAddress = host ? `${host} · ${t.offline}` : t.offline
  const remoteAddress = remoteServer?.baseUrl ?? ''

  const openLocal = () => {
    if (notInitialized) {
      navigate('server-uninit')
      return
    }
    navigate(status?.state === 'stopped' ? 'server-stopped' : 'server-local')
  }
  const openRemote = () => {
    navigate(remoteCurrent ? 'server-remote-detail' : 'server-remote-add')
  }

  return (
    <Page>
      <TopBar title={t.pickerTitle} onBack={() => navigate(back)} />
      <PageBody pad="server">
        <Card padding="option" className={localCurrent ? styles.current : undefined}>
          <button type="button" className={styles.main} onClick={openLocal}>
            <span className={styles.head}>
              <span className={styles.icon}>
                <PhoneIcon size={22} />
              </span>
              <span className={styles.title}>{t.localName}</span>
              {localCurrent ? <Badge>{t.current}</Badge> : null}
              <span className={styles.status}>
                <span className={localRunning ? styles.dot : styles.dotIdle} aria-hidden="true" />
                {localState}
              </span>
            </span>
            <span className={styles.desc}>{t.localDesc}</span>
            <span className={styles.address}>{localAddress}</span>
          </button>
          <div className={styles.actions}>
            {localCurrent ? (
              <Button variant="quiet" block disabled className={styles.action}>
                {t.currentInUse}
              </Button>
            ) : (
              <Button variant="ghost" block className={styles.action} onClick={openLocal}>
                {t.useLocal}
              </Button>
            )}
          </div>
        </Card>

        <Card padding="option" gap={16} className={remoteCurrent ? styles.current : undefined}>
          <button type="button" className={styles.main} onClick={openRemote}>
            <span className={styles.head}>
              <span className={styles.icon}>
                <GlobeIcon size={22} />
              </span>
              <span className={styles.title}>{t.remoteName}</span>
              {remoteCurrent ? <Badge>{t.current}</Badge> : null}
              {remoteCurrent ? (
                <span className={styles.status}>
                  <span className={styles.dot} aria-hidden="true" />
                  {t.connected}
                </span>
              ) : null}
            </span>
            <span className={styles.desc}>{t.remoteDesc}</span>
            {remoteAddress ? <span className={styles.address}>{remoteAddress}</span> : null}
          </button>
          <div className={styles.actions}>
            {remoteCurrent ? (
              <Button variant="quiet" block disabled className={styles.action}>
                {t.currentInUse}
              </Button>
            ) : (
              <Button variant="ghost" block className={styles.action} onClick={openRemote}>
                {t.connectRemote}
              </Button>
            )}
          </div>
        </Card>

        <p className={styles.note}>{t.pickerNote}</p>
      </PageBody>
    </Page>
  )
}
