import { useEffect, useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useToast } from '../../app/toast.js'
import { changeUsername } from '../../../services/api/server.js'
import { Button, Notice, Page, PageBody, Spinner, TextField, TopBar } from '../../ui/index.js'
import { apiStatus, refreshAfterAccountChange, USERNAME_PATTERN, useHttpUser } from './shared.js'
import shared from './shared.module.css'
import styles from './AccountUsernameScreen.module.css'
import { useAccountStrings } from './strings.js'

/**
 * 用户名（示意 28）。
 *
 * 只改 HTTP 登录账户的用户名（`PUT /api/v1/auth/username`），不是本机账户列表里的
 * 用户名。按钮在「没改 / 还没读到当前用户」时禁用；改错了才出现红圈和红字。
 */
export const AccountUsernameScreen = () => {
  const t = useAccountStrings()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { user, state, reload } = useHttpUser()
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverFieldError, setServerFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      setValue(user.username)
    }
  }, [user])

  const trimmed = value.trim()
  const invalid = touched && !USERNAME_PATTERN.test(trimmed)
  const fieldError = (invalid ? t.usernameInvalid : null) ?? serverFieldError
  const unchanged = user !== null && trimmed === user.username
  const disabled = busy || user === null || trimmed.length === 0 || unchanged

  const submit = async (): Promise<void> => {
    setTouched(true)
    setServerFieldError(null)
    setSubmitError(null)
    if (!USERNAME_PATTERN.test(trimmed)) {
      return
    }
    if (busy || !user || trimmed === user.username) {
      return
    }
    setBusy(true)
    try {
      await changeUsername(trimmed)
      // 用户名可能影响服务端设置归属；成功后按约定刷新一次设置状态再返回。
      await refreshAfterAccountChange()
      showToast(t.usernameUpdated)
      navigate('account-manage')
    } catch (error) {
      const status = apiStatus(error)
      if (status === 409) {
        setServerFieldError(t.usernameTaken)
      } else if (status === 400) {
        setServerFieldError(t.usernameInvalid)
      } else if (status === 401) {
        setSubmitError(t.sessionExpired)
      } else {
        setSubmitError(t.saveFailed)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page tone="group">
      <TopBar title={t.usernameTitle} onBack={() => navigate('account-manage')} />
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

        {state === 'ready' ? (
          <form
            className={styles.form}
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
              aria-label={t.usernameTitle}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setServerFieldError(null)
                setSubmitError(null)
              }}
              hint={fieldError ? undefined : t.usernameRule}
              error={fieldError ?? undefined}
            />
            {submitError ? <p className={shared.formError}>{submitError}</p> : null}
            <Button
              type="submit"
              size="page"
              block
              loading={busy}
              disabled={disabled}
              className={shared.submit}
            >
              {t.confirm}
            </Button>
          </form>
        ) : null}
      </PageBody>
    </Page>
  )
}
