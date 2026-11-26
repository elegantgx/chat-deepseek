import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { PageBody, PageHead } from '../../app'
import type { AccountGroup, AccountRow, AuthState } from '../../app/ipc-types'
import {
  Badge,
  Button,
  Card,
  CardFooter,
  Field,
  PlusIcon,
  Table,
  TextButton,
  Toast,
} from '../../ui'
import type { TableColumn } from '../../ui'
import { AddAccountDialog, ChangePasswordDialog, DeleteAccountDialog } from './AccountDialogs'
import type { AddAccountValues } from './AccountDialogs'
import { FIXTURE_ACCOUNTS, FIXTURE_AUTH } from './fixtures'
import styles from './page.module.css'

type DialogState =
  | { kind: 'add' }
  | { kind: 'password'; accountId: string }
  | { kind: 'delete'; accountId: string }

interface ToastMessage {
  tone: 'success' | 'error'
  text: string
}

const GROUP_RANK: Record<AccountGroup, number> = { User: 0, Admin: 1, Owner: 2 }

/** 样本操作的模拟延迟；真后端里由 ipc 往返决定 */
const OPERATION_DELAY = 420

function delay(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, OPERATION_DELAY)
  })
}

/**
 * hash 既是路由也是截图开关：
 * `#accounts-login` 初始未登录，`#accounts-add` 初始打开添加对话框，`#accounts-dark` 只切主题。
 */
function readHashMode(): { login: boolean; add: boolean } {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const parts = raw.split('-')
  return { login: parts.includes('login'), add: parts.includes('add') }
}

function roleLabel(groups: readonly AccountGroup[] | undefined): string {
  let highest: AccountGroup = 'User'
  for (const group of groups ?? []) {
    if (GROUP_RANK[group] > GROUP_RANK[highest]) {
      highest = group
    }
  }
  switch (highest) {
    case 'Owner':
      return '所有者'
    case 'Admin':
      return '管理员'
    default:
      return '成员'
  }
}

/** 头像块用用户名前两位，和效果图的 GX / CH / LI 一致 */
function initials(username: string): string {
  return username.slice(0, 2).toUpperCase() || '—'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const COLUMNS: ReadonlyArray<TableColumn<AccountRow>> = [
  {
    key: 'username',
    header: '用户名',
    width: '26%',
    render: (row) => (
      <span className={styles.cellUser}>
        <span className={styles.avatarSm} aria-hidden="true">
          {initials(row.username)}
        </span>
        {row.username}
      </span>
    ),
  },
  {
    key: 'role',
    header: '角色',
    width: '14%',
    render: (row) => roleLabel(row.groups),
  },
  {
    key: 'createdAt',
    header: '创建时间',
    width: '26%',
    render: (row) => <span className={styles.createdAt}>{formatDateTime(row.createdAt)}</span>,
  },
]

interface LoginCardProps {
  busy: boolean
  onLogin: (username: string, password: string) => Promise<string | null>
}

function LoginCard({ busy, onLogin }: LoginCardProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) {
      return
    }
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    setError('')
    const message = await onLogin(username, password)
    if (message) {
      setError(message)
    }
  }

  return (
    <div className={styles.loginArea}>
      <Card className={styles.loginCard}>
        <div className={styles.loginHeading}>
          <h2 className={styles.loginTitle}>登录账户</h2>
          <p className={styles.loginDescription}>使用账户登录管理控制台。</p>
        </div>
        <form className={styles.loginForm} onSubmit={handleSubmit} noValidate>
          <Field
            label="用户名"
            value={username}
            onChange={(value) => {
              setUsername(value)
              if (error) {
                setError('')
              }
            }}
            autoComplete="username"
            fullWidth
            disabled={busy}
          />
          <Field
            label="密码"
            type="password"
            value={password}
            onChange={(value) => {
              setPassword(value)
              if (error) {
                setError('')
              }
            }}
            autoComplete="current-password"
            fullWidth
            disabled={busy}
          />
          <p className={styles.loginError} role={error ? 'alert' : undefined}>
            {error}
          </p>
          <Button tone="primary" type="submit" className={styles.loginSubmit} disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </Button>
        </form>
      </Card>
    </div>
  )
}

export function AccountsPage() {
  const [initialMode] = useState(readHashMode)
  const [auth, setAuth] = useState<AuthState>(() =>
    initialMode.login ? { authenticated: false } : FIXTURE_AUTH
  )
  const [accounts, setAccounts] = useState<AccountRow[]>(() => [...FIXTURE_ACCOUNTS.accounts])
  const [dialog, setDialog] = useState<DialogState | null>(() =>
    initialMode.login || !initialMode.add ? null : { kind: 'add' }
  )
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  // 用 ref 卡住重复提交：双击时 state 还没刷新，光看 busy 不够
  const busyRef = useRef(false)

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => {
      window.clearTimeout(timer)
    }
  }, [toast])

  const beginOperation = (): boolean => {
    if (busyRef.current) {
      return false
    }
    busyRef.current = true
    setBusy(true)
    return true
  }

  const endOperation = () => {
    busyRef.current = false
    setBusy(false)
  }

  const showToast = (tone: ToastMessage['tone'], text: string) => {
    setToast({ tone, text })
  }

  const closeDialog = () => {
    if (!busyRef.current) {
      setDialog(null)
    }
  }

  const openAdd = () => {
    if (!busyRef.current) {
      setDialog({ kind: 'add' })
    }
  }

  const openPassword = (account: AccountRow) => {
    if (!busyRef.current) {
      setDialog({ kind: 'password', accountId: account.id })
    }
  }

  const openDelete = (account: AccountRow) => {
    if (!busyRef.current && !account.self) {
      setDialog({ kind: 'delete', accountId: account.id })
    }
  }

  const handleLogin = async (username: string, password: string): Promise<string | null> => {
    if (!beginOperation()) {
      return '操作进行中，请稍候'
    }
    await delay()
    const match = accounts.find(
      (account) => account.username.toLowerCase() === username.trim().toLowerCase()
    )
    // 样本阶段不校验真实密码；保留“密码非空”这一步，登录后的 self 标记按用户切换
    if (!match || !password) {
      endOperation()
      return '用户名或密码错误'
    }
    setAccounts((prev) => prev.map((account) => ({ ...account, self: account.id === match.id })))
    setAuth({
      authenticated: true,
      username: match.username,
      groups: match.groups,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    endOperation()
    showToast('success', `欢迎回来，${match.username}`)
    return null
  }

  const handleLogout = async () => {
    if (!beginOperation()) {
      return
    }
    await delay()
    setAccounts((prev) => prev.map((account) => ({ ...account, self: false })))
    setAuth({ authenticated: false })
    setDialog(null)
    endOperation()
    showToast('success', '已退出登录')
  }

  const handleAddAccount = async (values: AddAccountValues) => {
    if (!beginOperation()) {
      return
    }
    await delay()
    const now = new Date()
    const groups: AccountGroup[] = values.role === 'Admin' ? ['User', 'Admin'] : ['User']
    setAccounts((prev) => [
      ...prev,
      {
        id: `acct-${now.getTime()}-${prev.length}`,
        username: values.username,
        groups,
        disabled: false,
        createdAt: now.toISOString(),
        self: false,
      },
    ])
    setDialog(null)
    endOperation()
    showToast('success', `已添加用户 ${values.username}`)
  }

  const handleChangePassword = async (password: string) => {
    const target =
      dialog?.kind === 'password' ? accounts.find((a) => a.id === dialog.accountId) : null
    // 对话框已经校验过；页面侧再守一次，避免无效密码被当成成功
    if (!target || password.length < 8 || !beginOperation()) {
      return
    }
    await delay()
    setDialog(null)
    endOperation()
    showToast('success', `已更新 ${target.username} 的密码`)
  }

  const handleDeleteAccount = async () => {
    const target =
      dialog?.kind === 'delete' ? accounts.find((a) => a.id === dialog.accountId) : null
    if (!target || target.self || !beginOperation()) {
      return
    }
    await delay()
    setAccounts((prev) => prev.filter((account) => account.id !== target.id))
    setDialog(null)
    endOperation()
    showToast('success', `已删除账户 ${target.username}`)
  }

  const passwordTarget =
    dialog?.kind === 'password'
      ? (accounts.find((account) => account.id === dialog.accountId) ?? null)
      : null
  const deleteTarget =
    dialog?.kind === 'delete'
      ? (accounts.find((account) => account.id === dialog.accountId) ?? null)
      : null

  return (
    <>
      <PageHead
        title="账户"
        actions={
          auth.authenticated ? (
            <Button tone="primary" icon={<PlusIcon />} disabled={busy} onClick={openAdd}>
              添加用户
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        {auth.authenticated ? (
          <>
            <Card className={styles.currentCard}>
              <span className={styles.avatar} aria-hidden="true">
                {initials(auth.username ?? '')}
              </span>
              <div className={styles.userInfo}>
                <div className={styles.userLine}>
                  <span className={styles.userName}>{auth.username ?? '—'}</span>
                  <Badge>{roleLabel(auth.groups)}</Badge>
                </div>
                <span className={styles.userSub}>当前登录</span>
              </div>
              <Button
                tone="secondary"
                className={styles.logout}
                disabled={busy}
                onClick={handleLogout}
              >
                退出
              </Button>
            </Card>

            <p className={styles.note}>账户用于登录 Web 端和 GUI</p>

            <Card grow clip>
              <div className={styles.tableScroll}>
                <Table
                  caption="账户列表"
                  columns={COLUMNS}
                  rows={accounts}
                  rowKey={(row) => row.id}
                  actions={{
                    width: '34%',
                    render: (row) => (
                      <>
                        <TextButton
                          tone="accent"
                          aria-label={`修改 ${row.username} 的密码`}
                          disabled={busy}
                          onClick={() => openPassword(row)}
                        >
                          改密码
                        </TextButton>
                        <TextButton
                          tone="danger"
                          aria-label={
                            row.self ? '当前登录账户不能删除' : `删除账户 ${row.username}`
                          }
                          disabled={busy || row.self}
                          onClick={() => openDelete(row)}
                        >
                          删除
                        </TextButton>
                      </>
                    ),
                  }}
                />
              </div>
              <CardFooter>共 {accounts.length} 个账户</CardFooter>
            </Card>
          </>
        ) : (
          <LoginCard busy={busy} onLogin={handleLogin} />
        )}
      </PageBody>

      <AddAccountDialog
        open={dialog?.kind === 'add'}
        busy={busy}
        existingUsernames={accounts.map((account) => account.username)}
        onClose={closeDialog}
        onSubmit={handleAddAccount}
      />
      <ChangePasswordDialog
        open={dialog?.kind === 'password'}
        account={passwordTarget}
        busy={busy}
        onClose={closeDialog}
        onSubmit={handleChangePassword}
      />
      <DeleteAccountDialog
        open={dialog?.kind === 'delete'}
        account={deleteTarget}
        busy={busy}
        onClose={closeDialog}
        onConfirm={handleDeleteAccount}
      />
      {toast ? (
        <Toast tone={toast.tone} className={styles.toast}>
          {toast.text}
        </Toast>
      ) : null}
    </>
  )
}
