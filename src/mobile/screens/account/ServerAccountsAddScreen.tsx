import { useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useHost, useIsMock } from '../../app/runtime.js'
import { useToast } from '../../app/toast.js'
import {
  Button,
  Card,
  ListRow,
  Page,
  PageBody,
  PasswordField,
  Radio,
  ShieldIcon,
  TextField,
  TopBar,
  UserIcon,
} from '../../ui/index.js'
import { hostErrorCode, MIN_PASSWORD_LENGTH, USERNAME_PATTERN } from './shared.js'
import shared from './shared.module.css'
import styles from './ServerAccountsAddScreen.module.css'
import { useAccountStrings } from './strings.js'

type Role = 'member' | 'admin'

/**
 * 添加本机账户（示意 21）。
 *
 * 角色只有成员/管理员两种（示意 §8）：不提供「所有者」，因为能建所有者的人自己就是
 * 所有者，建完平级、风险不对等。提交走 ipc `account.add`；管理员要求附加 `Admin` 组。
 */
export const ServerAccountsAddScreen = () => {
  const t = useAccountStrings()
  const host = useHost()
  const mock = useIsMock()
  const navigate = useNavigate()
  const { showToast } = useToast()
  // 示意 21 是一张已填写态：fake 预览里带上示例值方便逐像素对照；
  // 真壳仍然从空表单开始，不会把示例账户带进产品。
  const [username, setUsername] = useState(mock ? 'bob' : '')
  const [password, setPassword] = useState(mock ? 'mockpass' : '')
  const [confirm, setConfirm] = useState(mock ? 'mockpass' : '')
  const [role, setRole] = useState<Role>('member')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverUsernameError, setServerUsernameError] = useState<string | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)

  const trimmed = username.trim()
  const usernameError =
    (touched && !USERNAME_PATTERN.test(trimmed) ? t.usernameInvalid : null) ?? serverUsernameError
  const passwordError = touched && password.length < MIN_PASSWORD_LENGTH ? t.passwordTooShort : null
  const confirmError = touched && password !== confirm ? t.passwordMismatch : null
  const filled = trimmed.length > 0 && password.length > 0 && confirm.length > 0

  const submit = async (): Promise<void> => {
    setTouched(true)
    setServerUsernameError(null)
    setGeneralError(null)
    if (
      !USERNAME_PATTERN.test(trimmed) ||
      password.length < MIN_PASSWORD_LENGTH ||
      password !== confirm
    ) {
      return
    }
    if (busy) {
      return
    }
    setBusy(true)
    try {
      await host.request('account.add', {
        username: trimmed,
        password,
        ...(role === 'admin' ? { groups: ['User', 'Admin'] } : {}),
      })
      showToast(t.accountAdded)
      navigate('server-accounts')
    } catch (error) {
      const code = hostErrorCode(error)
      if (code === 'conflict') {
        setServerUsernameError(t.usernameTaken)
      } else if (code === 'permission_denied') {
        setGeneralError(t.permissionDenied)
      } else if (code === 'unauthenticated') {
        setGeneralError(t.manageSessionExpired)
      } else {
        setGeneralError(t.addFailed)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page tone="group">
      <TopBar title={t.addTitle} onBack={() => navigate('server-accounts')} />
      <PageBody pad="server">
        <form
          className={`${styles.form} ${shared.passwordPlaceholder}`}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <TextField
            variant="pill"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t.usernamePlaceholder}
            aria-label={t.usernamePlaceholder}
            value={username}
            onChange={(event) => {
              setUsername(event.target.value)
              setServerUsernameError(null)
            }}
            error={usernameError ?? undefined}
          />
          <PasswordField
            variant="pill"
            name="new-password"
            autoComplete="new-password"
            placeholder={t.passwordPlaceholder}
            aria-label={t.passwordPlaceholder}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={passwordError ?? undefined}
          />
          <PasswordField
            variant="pill"
            name="confirm-password"
            autoComplete="new-password"
            placeholder={t.confirmPasswordPlaceholder}
            aria-label={t.confirmPasswordPlaceholder}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            error={confirmError ?? undefined}
            hint={confirmError ? undefined : t.addHint}
          />

          <Card label={t.roleGroup} gap={28}>
            <ListRow
              icon={<UserIcon />}
              title={t.roleMember}
              subtitle={t.roleMemberSub}
              right={<Radio checked={role === 'member'} />}
              onClick={() => setRole('member')}
            />
            <ListRow
              icon={<ShieldIcon />}
              title={t.roleAdmin}
              subtitle={t.roleAdminSub}
              right={<Radio checked={role === 'admin'} />}
              onClick={() => setRole('admin')}
            />
          </Card>

          {generalError ? <p className={shared.formError}>{generalError}</p> : null}
          <Button
            type="submit"
            size="page"
            block
            loading={busy}
            disabled={!filled}
            className={shared.submitSpaced}
          >
            {t.create}
          </Button>
        </form>
      </PageBody>
    </Page>
  )
}
