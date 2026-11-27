import { useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useToast } from '../../app/toast.js'
import { changePassword } from '../../../services/api/server.js'
import { Button, Notice, Page, PageBody, PasswordField, Spinner, TopBar } from '../../ui/index.js'
import { apiStatus, MIN_PASSWORD_LENGTH, refreshAfterAccountChange, useHttpUser } from './shared.js'
import shared from './shared.module.css'
import styles from './AccountPasswordScreen.module.css'
import { useAccountStrings } from './strings.js'

/**
 * 密码（示意 29）。
 *
 * 改的是 HTTP 登录账户的密码（`POST /api/v1/auth/password`），必须带当前密码。
 * 三个输入框都是 type=password；密码只进请求体，不写日志、不留在组件外的状态里。
 * 修改成功后浏览器的登录状态继续有效，这里只刷新一次设置状态再返回。
 */
export const AccountPasswordScreen = () => {
  const t = useAccountStrings()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { state, reload } = useHttpUser()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [currentError, setCurrentError] = useState<string | null>(null)
  const [newError, setNewError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const newInvalid = touched && next.length < MIN_PASSWORD_LENGTH
  const confirmInvalid = touched && next !== confirm
  const newFieldError = (newInvalid ? t.newPasswordTooShort : null) ?? newError
  const confirmFieldError = confirmInvalid ? t.passwordMismatch : null
  const filled = current.length > 0 && next.length > 0 && confirm.length > 0
  const hasError =
    currentError !== null ||
    newFieldError !== null ||
    confirmFieldError !== null ||
    submitError !== null

  const submit = async (): Promise<void> => {
    setTouched(true)
    setCurrentError(null)
    setNewError(null)
    setSubmitError(null)
    if (next.length < MIN_PASSWORD_LENGTH || next !== confirm) {
      return
    }
    if (busy || current.length === 0) {
      return
    }
    setBusy(true)
    try {
      await changePassword(current, next)
      await refreshAfterAccountChange()
      showToast(t.passwordUpdated)
      navigate('account-manage')
    } catch (error) {
      const status = apiStatus(error)
      if (status === 401) {
        // 浏览器侧把 /auth/password 的 401 定义为「当前密码不对」，不当作会话过期。
        setCurrentError(t.currentPasswordWrong)
      } else if (status === 400) {
        setNewError(t.newPasswordTooShort)
      } else {
        setSubmitError(t.saveFailed)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page tone="group">
      <TopBar title={t.passwordTitle} onBack={() => navigate('account-manage')} />
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
            className={`${styles.form} ${shared.passwordPlaceholder}`}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <PasswordField
              variant="pill"
              name="current-password"
              autoComplete="current-password"
              placeholder={t.currentPasswordPlaceholder}
              aria-label={t.currentPasswordPlaceholder}
              value={current}
              onChange={(event) => {
                setCurrent(event.target.value)
                setCurrentError(null)
                setSubmitError(null)
              }}
              error={currentError ?? undefined}
            />
            <PasswordField
              variant="pill"
              name="new-password"
              autoComplete="new-password"
              placeholder={t.newPasswordPlaceholder}
              aria-label={t.newPasswordPlaceholder}
              value={next}
              onChange={(event) => {
                setNext(event.target.value)
                setNewError(null)
                setSubmitError(null)
              }}
              error={newFieldError ?? undefined}
            />
            <PasswordField
              variant="pill"
              name="confirm-password"
              autoComplete="new-password"
              placeholder={t.confirmNewPasswordPlaceholder}
              aria-label={t.confirmNewPasswordPlaceholder}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value)
                setSubmitError(null)
              }}
              error={confirmFieldError ?? undefined}
              hint={hasError ? undefined : t.passwordHint}
            />
            {submitError ? <p className={shared.formError}>{submitError}</p> : null}
            <Button
              type="submit"
              size="page"
              block
              loading={busy}
              disabled={!filled}
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
