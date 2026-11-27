import { useEffect, useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useHost, useReady } from '../../app/runtime.js'
import { useToast } from '../../app/toast.js'
import {
  Button,
  Card,
  Dialog,
  Empty,
  ListRow,
  Notice,
  Page,
  PageBody,
  PasswordField,
  PlusIcon,
  Sheet,
  SheetAction,
  Spinner,
  TopBar,
  UserIcon,
} from '../../ui/index.js'
import {
  fetchHostAccounts,
  formatCreatedAt,
  hostErrorCode,
  isHostUnauthenticated,
  MIN_PASSWORD_LENGTH,
  roleOf,
  type HostAccount,
} from './shared.js'
import shared from './shared.module.css'
import styles from './ServerAccountsScreen.module.css'
import { useAccountStrings } from './strings.js'

type LoadState = 'loading' | 'ready' | 'expired' | 'failed'
type SheetMode = 'actions' | 'password'

/**
 * 本机账户（示意 20）。
 *
 * 列表来自 ipc `account.list`；行尾箭头不是装饰——点开是本机账户的操作层，
 * 里面用 `account.password` 重置密码、`account.delete` 删除账户。删除与重置都没有
 * 「确认参数」，所以删除必须先走确认弹窗（docs/ipc.md §4.18–4.19）。
 */
export const ServerAccountsScreen = () => {
  const t = useAccountStrings()
  const host = useHost()
  const ready = useReady()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [accounts, setAccounts] = useState<HostAccount[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [attempt, setAttempt] = useState(0)

  const [selected, setSelected] = useState<HostAccount | null>(null)
  const [mode, setMode] = useState<SheetMode>('actions')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordServerError, setPasswordServerError] = useState<string | null>(null)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<HostAccount | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    let active = true
    setState('loading')
    fetchHostAccounts(host)
      .then((next) => {
        if (!active) {
          return
        }
        setAccounts(next)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (active) {
          setState(isHostUnauthenticated(error) ? 'expired' : 'failed')
        }
      })
    return () => {
      active = false
    }
  }, [host, attempt])

  const selectedServer = ready.servers.find((server) => server.id === ready.selectedId)
  const backTarget =
    selectedServer?.kind === 'remote'
      ? 'settings'
      : selectedServer?.mode === 'uninitialized'
        ? 'server-uninit'
        : selectedServer?.mode === 'stopped'
          ? 'server-stopped'
          : 'server-local'

  const subtitleFor = (account: HostAccount): string => {
    const role = t[roleOf(account.groups)]
    const base = account.self
      ? `${role} · ${t.selfSuffix}`
      : `${role} · ${formatCreatedAt(account.createdAt)}${t.createdSuffix}`
    return account.disabled ? `${base} · ${t.disabledSuffix}` : base
  }

  const openActions = (account: HostAccount) => {
    setSelected(account)
    setMode('actions')
    setNewPassword('')
    setPasswordError(null)
    setPasswordServerError(null)
  }

  const closeSheet = () => {
    if (passwordBusy) {
      return
    }
    setSelected(null)
    setMode('actions')
    setNewPassword('')
    setPasswordError(null)
    setPasswordServerError(null)
  }

  const openPassword = () => {
    setMode('password')
    setNewPassword('')
    setPasswordError(null)
    setPasswordServerError(null)
  }

  const submitPassword = async (): Promise<void> => {
    if (!selected || passwordBusy) {
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(t.newPasswordTooShort)
      return
    }
    setPasswordBusy(true)
    setPasswordError(null)
    setPasswordServerError(null)
    try {
      await host.request('account.password', {
        username: selected.username,
        password: newPassword,
      })
      showToast(t.passwordReset)
      setSelected(null)
      setMode('actions')
      setNewPassword('')
    } catch (error) {
      const code = hostErrorCode(error)
      if (code === 'bad_request') {
        setPasswordError(t.newPasswordTooShort)
      } else if (code === 'unauthenticated') {
        setPasswordServerError(t.manageSessionExpired)
      } else {
        setPasswordServerError(
          code === 'permission_denied'
            ? t.permissionDenied
            : code === 'not_found'
              ? t.accountNotFound
              : t.saveFailed
        )
      }
    } finally {
      setPasswordBusy(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget || deleteBusy) {
      return
    }
    setDeleteBusy(true)
    try {
      await host.request('account.delete', { username: deleteTarget.username })
      setAccounts((list) => list.filter((account) => account.username !== deleteTarget.username))
      setDeleteTarget(null)
      showToast(t.accountDeleted)
    } catch (error) {
      const code = hostErrorCode(error)
      showToast(
        code === 'permission_denied'
          ? t.deleteSelf
          : code === 'unauthenticated'
            ? t.manageSessionExpired
            : code === 'not_found'
              ? t.accountNotFound
              : t.saveFailed
      )
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <Page tone="group">
      <TopBar title={t.accountsTitle} onBack={() => navigate(backTarget)} />
      <PageBody pad="settings">
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
              <div>{t.manageSessionExpired}</div>
              <div>{t.chatUnaffected}</div>
            </Notice>
          </div>
        ) : null}

        {state === 'failed' ? (
          <div className={shared.notice}>
            <Notice
              tone="error"
              actions={[{ label: t.retry, onClick: () => setAttempt((value) => value + 1) }]}
            >
              {t.loadFailed}
            </Notice>
          </div>
        ) : null}

        {state === 'ready' && accounts.length === 0 ? (
          <Card label={t.accountGroup}>
            <Empty
              icon={<UserIcon size={26} />}
              title={t.emptyAccountsTitle}
              description={t.emptyAccountsDescription}
              action={
                <Button size="xs" onClick={() => navigate('server-accounts-add')}>
                  {t.addAccount}
                </Button>
              }
            />
          </Card>
        ) : null}

        {state === 'ready' && accounts.length > 0 ? (
          <>
            <Card label={t.accountGroup}>
              {accounts.map((account) => (
                <ListRow
                  key={account.id}
                  icon={<UserIcon />}
                  title={account.username}
                  subtitle={subtitleFor(account)}
                  showChevron
                  onClick={() => openActions(account)}
                />
              ))}
            </Card>
            <Card standalone>
              <ListRow
                icon={<PlusIcon />}
                title={t.addAccount}
                onClick={() => navigate('server-accounts-add')}
              />
            </Card>
          </>
        ) : null}

        {state !== 'loading' ? <p className={shared.note}>{t.accountsNote}</p> : null}
      </PageBody>

      <Sheet
        open={selected !== null}
        onClose={closeSheet}
        title={selected?.username}
        subtitle={selected ? subtitleFor(selected) : undefined}
        label={t.manageAccount}
      >
        {selected && mode === 'actions' ? (
          <>
            <SheetAction onClick={openPassword}>{t.resetPassword}</SheetAction>
            {selected.self ? (
              <p className={styles.sheetNote}>{t.currentAccountNotice}</p>
            ) : (
              <SheetAction
                danger
                onClick={() => {
                  setDeleteTarget(selected)
                  setSelected(null)
                }}
              >
                {t.deleteAccount}
              </SheetAction>
            )}
          </>
        ) : null}

        {selected && mode === 'password' ? (
          <form
            className={`${styles.sheetForm} ${shared.passwordPlaceholder}`}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void submitPassword()
            }}
          >
            <PasswordField
              variant="pill"
              name="new-password"
              autoComplete="new-password"
              placeholder={t.newPassword}
              aria-label={t.newPassword}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              hint={t.newPasswordHint}
              error={passwordError ?? undefined}
            />
            {passwordServerError ? <p className={shared.formError}>{passwordServerError}</p> : null}
            <Button
              type="submit"
              size="page"
              block
              loading={passwordBusy}
              disabled={newPassword.length === 0}
              className={styles.sheetSubmit}
            >
              {t.save}
            </Button>
          </form>
        ) : null}
      </Sheet>

      <Dialog
        open={deleteTarget !== null}
        title={t.deleteTitle}
        body={deleteTarget ? t.deleteBody.replace('{username}', deleteTarget.username) : undefined}
        cancelLabel={t.cancel}
        confirmLabel={t.deleteConfirm}
        danger
        confirmDisabled={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTarget(null)
          }
        }}
        onConfirm={() => {
          void confirmDelete()
        }}
      />
    </Page>
  )
}
