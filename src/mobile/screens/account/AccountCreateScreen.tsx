import { useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useHost } from '../../app/runtime.js'
import { useToast } from '../../app/toast.js'
import { Button, Page, PageBody, PasswordField, TextField, TopBar } from '../../ui/index.js'
import { hostErrorCode, MIN_PASSWORD_LENGTH, USERNAME_PATTERN } from './shared.js'
import shared from './shared.module.css'
import styles from './AccountCreateScreen.module.css'
import { useAccountStrings } from './strings.js'

/**
 * 创建本机账户（初始化流程的第 3 步，也对应示意 06/07）。
 *
 * 这是 ipc 的 `auth.setup`，不是 `/api/v1` 的登录账户：它只在数据目录还没有 Owner 时
 * 成功一次，成功后壳会同时建立 ipc 与 HTTP 两条会话。因此这里不调 HTTP login。
 *
 * 校验只在「已经点过创建」之后显示：进页面时输入框保持干净，不预判用户会写错。
 */

export interface AccountCreateSeed {
  username: string
  password: string
  confirm: string
  /** 示意 07 直接以「用户名不合规」的已提交态进入 */
  touched: boolean
}

interface AccountCreateFormProps {
  seed?: AccountCreateSeed
}

export const AccountCreateForm = ({ seed }: AccountCreateFormProps) => {
  const t = useAccountStrings()
  const host = useHost()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [username, setUsername] = useState(seed?.username ?? '')
  const [password, setPassword] = useState(seed?.password ?? '')
  const [confirm, setConfirm] = useState(seed?.confirm ?? '')
  const [touched, setTouched] = useState(seed?.touched ?? false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const trimmed = username.trim()
  const usernameInvalid = touched && !USERNAME_PATTERN.test(trimmed)
  const passwordInvalid = touched && password.length < MIN_PASSWORD_LENGTH
  const confirmInvalid = touched && password !== confirm
  const filled = trimmed.length > 0 && password.length > 0 && confirm.length > 0
  const hasError = usernameInvalid || passwordInvalid || confirmInvalid || serverError !== null

  const submit = async (): Promise<void> => {
    setTouched(true)
    setServerError(null)
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
      // 只走控制面：这是本机账户，HTTP 数据面由壳在 setup 成功后一并建立。
      await host.request('auth.setup', { username: trimmed, password })
      showToast(t.accountCreated)
      navigate('server-ready')
    } catch (error) {
      const code = hostErrorCode(error)
      if (code === 'conflict') {
        setServerError(t.accountConflict)
      } else if (code === 'bad_request') {
        // 本地已挡过一轮，能到这里通常是服务端规则更严（例如字节数）；
        // 直接展示服务端 message 会混中文到英文界面，所以给可执行的动作文案。
        setServerError(t.createFailed)
      } else {
        setServerError(t.createFailed)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page tone="group">
      <TopBar title={t.createTitle} onBack={() => navigate('server-preparing')} />
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
            onChange={(event) => setUsername(event.target.value)}
            error={usernameInvalid ? t.usernameInvalid : undefined}
          />
          <PasswordField
            variant="pill"
            name="new-password"
            autoComplete="new-password"
            placeholder={t.passwordPlaceholder}
            aria-label={t.passwordPlaceholder}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={passwordInvalid ? t.passwordTooShort : undefined}
          />
          <PasswordField
            variant="pill"
            name="confirm-password"
            autoComplete="new-password"
            placeholder={t.confirmPasswordPlaceholder}
            aria-label={t.confirmPasswordPlaceholder}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            error={confirmInvalid ? t.passwordMismatch : undefined}
            hint={hasError ? undefined : t.createHint}
          />
          {serverError ? <p className={shared.formError}>{serverError}</p> : null}
          <Button
            type="submit"
            size="page"
            block
            loading={busy}
            disabled={!filled}
            className={shared.submit}
          >
            {t.create}
          </Button>
        </form>
      </PageBody>
    </Page>
  )
}

export const AccountCreateScreen = () => <AccountCreateForm />

/** 示意 07：同一张表单的「用户名不合规」状态，不另起一套页面 */
export const AccountCreateErrorScreen = () => (
  <AccountCreateForm
    seed={{ username: 'gx@', password: 'mockpass', confirm: 'mockpass', touched: true }}
  />
)
