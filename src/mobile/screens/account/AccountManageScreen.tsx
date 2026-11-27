import { useRef, useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useToast } from '../../app/toast.js'
import { saveAvatar } from '../../../services/api/server.js'
import { fileToAvatarDataURL } from '../../../utils/avatar.js'
import {
  Avatar,
  CameraIcon,
  Card,
  KeyIcon,
  ListRow,
  Notice,
  Page,
  PageBody,
  Spinner,
  TopBar,
  UserIcon,
} from '../../ui/index.js'
import { avatarErrorKind, refreshAfterAccountChange, useHttpUser } from './shared.js'
import shared from './shared.module.css'
import styles from './AccountManageScreen.module.css'
import { useAccountStrings } from './strings.js'

/**
 * 账号管理（示意 27）。
 *
 * 这里全部是浏览器那套 HTTP 账户：`/api/v1/auth/me` 取当前登录人，
 * 头像与用户名只改当前连接的服务器，和 ipc 的本机账户列表是两件事。
 * 头像走浏览器已有的 `fileToAvatarDataURL` + `saveAvatar`，不新增上传协议。
 */
export const AccountManageScreen = () => {
  const t = useAccountStrings()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { user, state, setUser, reload } = useHttpUser()
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const uploadAvatar = async (file: File): Promise<void> => {
    if (!user || busy) {
      return
    }
    setBusy(true)
    try {
      const data = await fileToAvatarDataURL(file)
      await saveAvatar(data)
      setUser({ ...user, avatar: data })
      await refreshAfterAccountChange()
      showToast(t.avatarUpdated)
    } catch (error) {
      const kind = avatarErrorKind(error)
      showToast(
        kind === 'tooLarge' ? t.avatarTooLarge : kind === 'invalid' ? t.avatarInvalid : t.saveFailed
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page tone="group">
      <TopBar title={t.manageTitle} onBack={() => navigate('settings')} />
      <PageBody pad="server">
        {state === 'loading' ? (
          <div className={shared.loading}>
            <Spinner />
          </div>
        ) : null}

        {state === 'expired' ? (
          <div className={shared.notice}>
            <Notice
              tone="error"
              actions={[{ label: t.loginAgain, onClick: () => navigate('server-remote-login') }]}
            >
              {t.sessionExpired}
            </Notice>
          </div>
        ) : null}

        {state === 'failed' ? (
          <div className={shared.notice}>
            <Notice tone="error" actions={[{ label: t.retry, onClick: reload }]}>
              {t.networkError}
            </Notice>
          </div>
        ) : null}

        {state === 'ready' && user ? (
          <>
            <div className={shared.profile}>
              <button
                type="button"
                className={shared.avatarButton}
                aria-label={t.changeAvatar}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Avatar
                  size="lg"
                  // 示意里的头像字是大写 G；Avatar 取首字符，这里只在展示层转大写。
                  name={user.username.toUpperCase()}
                  icon={
                    user.avatar ? (
                      <img className={shared.avatarImage} src={user.avatar} alt="" />
                    ) : undefined
                  }
                  badge={<CameraIcon size={14} />}
                />
              </button>
              <span className={`${shared.profileName} ${styles.profileName}`}>{user.username}</span>
              <input
                ref={fileRef}
                className={shared.hiddenInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label={t.changeAvatar}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) {
                    void uploadAvatar(file)
                  }
                }}
              />
            </div>

            <Card gap={28}>
              <ListRow
                icon={<UserIcon />}
                title={t.manageUsername}
                showChevron
                onClick={() => navigate('account-username')}
              />
              <ListRow
                icon={<KeyIcon />}
                title={t.managePassword}
                showChevron
                onClick={() => navigate('account-password')}
              />
            </Card>

            <p className={shared.note}>{t.manageNote}</p>
          </>
        ) : null}
      </PageBody>
    </Page>
  )
}
