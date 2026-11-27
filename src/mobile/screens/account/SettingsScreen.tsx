import { useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useReady, useHost } from '../../app/runtime.js'
import { useToast } from '../../app/toast.js'
import { getMe, logout as logoutHttp } from '../../../services/api/server.js'
import { useSettings } from '../../../services/settings.js'
import {
  Card,
  DataIcon,
  Dialog,
  DocIcon,
  GlobeIcon,
  InfoIcon,
  ListRow,
  LogoutIcon,
  Page,
  PageBody,
  PageFooter,
  ServerIcon,
  Sheet,
  SunIcon,
  TopBar,
  UserIcon,
} from '../../ui/index.js'
import { apiStatus, isHostUnauthenticated } from './shared.js'
import styles from './SettingsScreen.module.css'
import { useAccountStrings } from './strings.js'

type ServerTarget =
  | 'server-picker'
  | 'server-uninit'
  | 'server-stopped'
  | 'server-local'
  | 'server-remote-detail'
  | 'server-remote-detail-offline'

/**
 * 设置（示意 13）。
 *
 * 结构就是 5 组：服务器 / 账户 / 应用 / 关于 / 退出登录；字体大小、外观、语言只做
 * 入口与跳转，目标屏由别的屏组实现（本批不在这里弹面板）。
 *
 * 服务器组的跳转按当前选中服务器与它的 mode 决定：本机的三态各有详情页，
 * 远程只有详情/离线两态；没有选中服务器时去切换页，不硬编码「本机」。
 */
export const SettingsScreen = () => {
  const t = useAccountStrings()
  const ready = useReady()
  const host = useHost()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const locale = useSettings((state) => state.locale)
  const themePreference = useSettings((state) => state.themePreference)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [licenseOpen, setLicenseOpen] = useState(false)

  const server = ready.servers.find((item) => item.id === ready.selectedId) ?? ready.servers[0]
  const serverTarget: ServerTarget = !server
    ? 'server-picker'
    : server.kind === 'remote'
      ? server.mode === 'stopped'
        ? 'server-remote-detail-offline'
        : 'server-remote-detail'
      : server.mode === 'uninitialized'
        ? 'server-uninit'
        : server.mode === 'stopped'
          ? 'server-stopped'
          : 'server-local'

  const languageValue = locale === 'en-US' ? t.languageEnglish : t.languageChinese
  const appearanceValue =
    themePreference === 'light'
      ? t.appearanceLight
      : themePreference === 'dark'
        ? t.appearanceDark
        : t.appearanceSystem

  /**
   * 退出登录要同时落两边：HTTP 会话（聊天数据面）与 ipc 管理会话（本机控制面）。
   * 两边都尽力执行；已过期视为成功（目标状态就是未登录）。任一边真失败就不跳转，
   * 避免「看起来退出了，另半边其实还登着」。
   */
  const signOut = async (): Promise<void> => {
    if (loggingOut) {
      return
    }
    setLoggingOut(true)
    let failed = false
    try {
      // 先取一次会话拿 CSRF；已经过期时 getMe 返回 null，下面 logout 的 401 也算成功。
      await getMe().catch(() => null)
      await logoutHttp()
    } catch (error) {
      if (apiStatus(error) !== 401) {
        failed = true
      }
    }
    try {
      await host.request('auth.logout')
    } catch (error) {
      if (!isHostUnauthenticated(error)) {
        failed = true
      }
    }
    setLoggingOut(false)
    if (failed) {
      showToast(t.logoutFailed)
      return
    }
    setLogoutOpen(false)
    // 退出后回到登录页；不留在设置里展示一个已经失效的账户。
    navigate('server-remote-login')
  }

  return (
    <Page tone="group">
      <TopBar title={t.settingsTitle} onBack={() => navigate('chat-welcome')} />
      <PageBody pad="settings">
        <Card label={t.serverGroup}>
          <ListRow
            icon={<ServerIcon />}
            title={server?.name ?? t.noServer}
            showChevron
            onClick={() => navigate(serverTarget)}
          />
        </Card>

        <Card label={t.accountGroup}>
          <ListRow
            icon={<UserIcon />}
            title={t.manageAccount}
            showChevron
            onClick={() => navigate('account-manage')}
          />
          <ListRow
            icon={<DataIcon />}
            title={t.dataManage}
            showChevron
            onClick={() => navigate('data-manage')}
          />
        </Card>

        <Card label={t.appGroup}>
          <ListRow
            icon={<GlobeIcon />}
            title={t.language}
            value={languageValue}
            showChevron
            onClick={() => navigate('language-dialog')}
          />
          <ListRow
            icon={<SunIcon />}
            title={t.appearance}
            value={appearanceValue}
            showChevron
            onClick={() => navigate('appearance-dialog')}
          />
          <ListRow
            icon={
              <span className={styles.aa}>
                <b>A</b>
                <b>A</b>
              </span>
            }
            title={t.fontSize}
            showChevron
            onClick={() => navigate('font-size')}
          />
        </Card>

        <Card label={t.aboutGroup}>
          <ListRow icon={<InfoIcon />} title={t.version} value={ready.version} valueMono />
          <ListRow
            icon={<DocIcon />}
            title={t.licenses}
            showChevron
            onClick={() => setLicenseOpen(true)}
          />
        </Card>

        <Card standalone>
          <ListRow icon={<LogoutIcon />} title={t.logout} onClick={() => setLogoutOpen(true)} />
        </Card>
      </PageBody>

      <PageFooter version={`chat-deepseek ${ready.version}`}>{t.footerNotice}</PageFooter>

      <Sheet
        open={licenseOpen}
        onClose={() => setLicenseOpen(false)}
        title={t.licenses}
        label={t.licenses}
      >
        <p className={styles.license}>{t.licenseBody}</p>
      </Sheet>

      <Dialog
        open={logoutOpen}
        title={t.logoutTitle}
        body={t.logoutBody}
        cancelLabel={t.cancel}
        confirmLabel={t.logout}
        danger
        confirmDisabled={loggingOut}
        onCancel={() => {
          if (!loggingOut) {
            setLogoutOpen(false)
          }
        }}
        onConfirm={() => {
          void signOut()
        }}
      />
    </Page>
  )
}
