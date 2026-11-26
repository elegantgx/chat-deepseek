import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { PageBody, PageHead, normalizeHostError, useHost, useRequest } from '../../app'
import type { HostError } from '../../app'
import type { AccountGroup, AccountList, AccountRow, AuthState } from '../../app/ipc-types'
import {
  AlertTriangleIcon,
  Badge,
  Button,
  Card,
  CardFooter,
  EmptyState,
  Field,
  PlusIcon,
  Table,
  TextButton,
  Toast,
} from '../../ui'
import type { TableColumn, ToastTone } from '../../ui'
import { AddAccountDialog, ChangePasswordDialog, DeleteAccountDialog } from './AccountDialogs'
import type { AddAccountValues } from './AccountDialogs'
import styles from './page.module.css'

type DialogState =
  | { kind: 'add' }
  | { kind: 'password'; accountId: string }
  | { kind: 'delete'; accountId: string }

interface ToastMessage {
  tone: ToastTone
  text: string
}

type AccountAction = 'add' | 'password' | 'delete'

const GROUP_RANK: Record<AccountGroup, number> = { User: 0, Admin: 1, Owner: 2 }

/** 操作者权限按最高组算，与后端 highestRank 一致 */
function highestRank(groups: readonly AccountGroup[] | undefined): number {
  let rank = GROUP_RANK.User
  for (const group of groups ?? []) {
    if (GROUP_RANK[group] > rank) {
      rank = GROUP_RANK[group]
    }
  }
  return rank
}

function roleLabel(groups: readonly AccountGroup[] | undefined): string {
  const rank = highestRank(groups)
  if (rank >= GROUP_RANK.Owner) {
    return '所有者'
  }
  if (rank >= GROUP_RANK.Admin) {
    return '管理员'
  }
  return '成员'
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

/** 写操作失败文案按 code 分支；message 只用于诊断，不能拿来驱动提示 */
function failureText(action: AccountAction, error: HostError): string {
  switch (error.code) {
    case 'unauthenticated':
      return '登录已过期，请重新登录'
    case 'bad_request':
      return error.message
    case 'not_found':
      return '账户不存在'
    case 'conflict':
      return action === 'add' ? '用户名已存在' : error.message
    case 'permission_denied':
      // 同码有「只有 Owner 可以操作 X」「不能删除自己」「不能删除最后一名活动 Owner」
      // 等多种原因，直接展示后端 message，避免固定文案误报
      return error.message
    default:
      return error.message
  }
}

function failureToast(action: AccountAction, error: HostError): string {
  return `${error.code}: ${failureText(action, error)}`
}

interface ReadErrorCardProps {
  title: string
  error: HostError
  busy: boolean
  onRetry: () => void
}

/** 读失败不落成空表：明确说明失败原因，并给一次重试 */
function ReadErrorCard({ title, error, busy, onRetry }: ReadErrorCardProps) {
  return (
    <Card grow>
      <div className={styles.stateArea}>
        <EmptyState
          title={title}
          description={`${error.code}: ${error.message}`}
          icon={<AlertTriangleIcon />}
          action={
            <Button tone="secondary" disabled={busy} onClick={onRetry}>
              重试
            </Button>
          }
        />
      </div>
    </Card>
  )
}

function LoadingCard({ title, description }: { title: string; description?: string }) {
  return (
    <Card grow>
      <div className={styles.stateArea}>
        <EmptyState title={title} description={description} />
      </div>
    </Card>
  )
}

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

interface AccountsPanelProps {
  auth: AuthState
  sessionBusy: boolean
  onLogout: () => void
  onSessionLost: () => void
  showToast: (tone: ToastTone, text: string) => void
}

/**
 * 已登录后的账户列表。只在 `auth.whoami` 为 true 时挂载，
 * 退出登录时随登录卡切换一起卸载，列表数据自然清空。
 */
function AccountsPanel({
  auth,
  sessionBusy,
  onLogout,
  onSessionLost,
  showToast,
}: AccountsPanelProps) {
  const host = useHost()
  const list = useRequest<AccountList>('account.list')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [busy, setBusy] = useState(false)
  // 用 ref 卡住重复提交：双击时 state 还没刷新，光看 busy 不够
  const busyRef = useRef(false)

  const accounts = list.data?.accounts ?? []
  const frozen = busy || sessionBusy
  const operatorRank = highestRank(auth.groups)
  const canAssignAdmin = operatorRank >= GROUP_RANK.Owner
  // 与后端 canOperate 一致：Owner 可以操作任何人，其他角色只能操作权限严格更低的账户
  const canOperate = (account: AccountRow): boolean =>
    operatorRank >= GROUP_RANK.Owner || highestRank(account.groups) < operatorRank

  // 列表读到未登录说明会话在中途失效，回上层重新走 whoami，而不是留在空表
  useEffect(() => {
    if (list.error?.code === 'unauthenticated') {
      onSessionLost()
    }
  }, [list.error, onSessionLost])

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
    if (!busyRef.current && canOperate(account)) {
      setDialog({ kind: 'password', accountId: account.id })
    }
  }

  const openDelete = (account: AccountRow) => {
    if (!busyRef.current && canOperate(account) && !account.self) {
      setDialog({ kind: 'delete', accountId: account.id })
    }
  }

  const handleAddAccount = async (values: AddAccountValues) => {
    if (!beginOperation()) {
      return
    }
    try {
      // 契约：省略 groups 时后端默认 ["User"]，Admin 只有不传 groups 才能创建普通成员；
      // 显式传任何非空 groups 都需要 Owner，所以成员角色不能传 ['User']。
      await host.request('account.add', {
        username: values.username,
        password: values.password,
        ...(values.role === 'Admin' ? { groups: ['User', 'Admin'] } : {}),
      })
      setDialog(null)
      showToast('success', `已添加用户 ${values.username}`)
      list.reload()
    } catch (failure) {
      const error = normalizeHostError(failure)
      showToast('error', failureToast('add', error))
      if (error.code === 'unauthenticated') {
        onSessionLost()
      }
    } finally {
      endOperation()
    }
  }

  const handleChangePassword = async (password: string) => {
    const target =
      dialog?.kind === 'password' ? accounts.find((a) => a.id === dialog.accountId) : null
    // 对话框已经校验过；页面侧再守一次，避免无效密码被当成成功
    if (!target || !beginOperation()) {
      return
    }
    try {
      await host.request('account.password', { username: target.username, password })
      setDialog(null)
      showToast('success', `已更新 ${target.username} 的密码`)
      if (target.self) {
        // 重置自己的密码会吊销当前会话，直接回登录态重新确认
        onSessionLost()
      } else {
        list.reload()
      }
    } catch (failure) {
      const error = normalizeHostError(failure)
      showToast('error', failureToast('password', error))
      if (error.code === 'unauthenticated') {
        onSessionLost()
      }
    } finally {
      endOperation()
    }
  }

  const handleDeleteAccount = async () => {
    const target =
      dialog?.kind === 'delete' ? accounts.find((a) => a.id === dialog.accountId) : null
    if (!target || target.self || !beginOperation()) {
      return
    }
    try {
      await host.request('account.delete', { username: target.username })
      setDialog(null)
      showToast('success', `已删除账户 ${target.username}`)
      list.reload()
    } catch (failure) {
      const error = normalizeHostError(failure)
      showToast('error', failureToast('delete', error))
      if (error.code === 'unauthenticated') {
        onSessionLost()
      }
    } finally {
      endOperation()
    }
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
          <Button tone="primary" icon={<PlusIcon />} disabled={frozen} onClick={openAdd}>
            添加用户
          </Button>
        }
      />
      <PageBody>
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
          <Button tone="secondary" className={styles.logout} disabled={frozen} onClick={onLogout}>
            退出
          </Button>
        </Card>

        <p className={styles.note}>账户用于登录 Web 端和桌面端</p>

        {list.error ? (
          <ReadErrorCard
            title="无法加载账户列表"
            error={list.error}
            busy={list.loading}
            onRetry={list.reload}
          />
        ) : list.data ? (
          <Card grow clip>
            <div className={styles.tableScroll}>
              <Table
                caption="账户列表"
                columns={COLUMNS}
                rows={accounts}
                rowKey={(row) => row.id}
                actions={{
                  width: '34%',
                  render: (row) => {
                    const operable = canOperate(row)
                    return (
                      <>
                        <TextButton
                          tone="accent"
                          aria-label={`修改 ${row.username} 的密码`}
                          disabled={frozen || !operable}
                          onClick={() => openPassword(row)}
                        >
                          改密码
                        </TextButton>
                        <TextButton
                          tone="danger"
                          aria-label={
                            row.self ? '当前登录账户不能删除' : `删除账户 ${row.username}`
                          }
                          disabled={frozen || !operable || row.self}
                          onClick={() => openDelete(row)}
                        >
                          删除
                        </TextButton>
                      </>
                    )
                  },
                }}
              />
            </div>
            <CardFooter>共 {accounts.length} 个账户</CardFooter>
          </Card>
        ) : (
          <LoadingCard title="正在加载账户…" description="账户列表来自本机 ipc。" />
        )}
      </PageBody>

      <AddAccountDialog
        open={dialog?.kind === 'add'}
        busy={busy}
        canAssignAdmin={canAssignAdmin}
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
    </>
  )
}

export function AccountsPage() {
  const host = useHost()
  const whoami = useRequest<AuthState>('auth.whoami')
  const { reload: reloadWhoami } = whoami
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [sessionBusy, setSessionBusy] = useState(false)
  // 登录 / 退出的在途标记也放 ref：whoami 重新拉取期间 state 可能还没刷新
  const sessionBusyRef = useRef(false)

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => {
      window.clearTimeout(timer)
    }
  }, [toast])

  // 登录 / 退出后等 whoami 回来再解除禁用，避免在登录卡与账户视图之间重复点击
  useEffect(() => {
    if (whoami.loading || !sessionBusyRef.current) {
      return
    }
    sessionBusyRef.current = false
    setSessionBusy(false)
  }, [whoami.loading])

  const showToast = useCallback((tone: ToastTone, text: string) => {
    setToast({ tone, text })
  }, [])

  const handleSessionLost = useCallback(() => {
    reloadWhoami()
  }, [reloadWhoami])

  const beginSession = (): boolean => {
    if (sessionBusyRef.current) {
      return false
    }
    sessionBusyRef.current = true
    setSessionBusy(true)
    return true
  }

  const endSession = () => {
    sessionBusyRef.current = false
    setSessionBusy(false)
  }

  const handleLogin = async (username: string, password: string): Promise<string | null> => {
    if (!beginSession()) {
      return '操作进行中，请稍候'
    }
    try {
      await host.request('auth.login', { username: username.trim(), password })
    } catch (failure) {
      endSession()
      const error = normalizeHostError(failure)
      if (error.code === 'unauthenticated') {
        return '用户名或密码错误'
      }
      showToast('error', `${error.code}: ${error.message}`)
      return '登录失败，请稍后重试'
    }
    // 成功后以 whoami 为准确认会话，列表会在 authenticated 为 true 后自行拉取
    showToast('success', `欢迎回来，${username.trim()}`)
    reloadWhoami()
    return null
  }

  const handleLogout = async () => {
    if (!beginSession()) {
      return
    }
    try {
      await host.request('auth.logout')
    } catch (failure) {
      endSession()
      const error = normalizeHostError(failure)
      showToast('error', `${error.code}: ${error.message}`)
      return
    }
    showToast('success', '已退出登录')
    reloadWhoami()
  }

  const toastNode = toast ? (
    <Toast tone={toast.tone} className={styles.toast}>
      {toast.text}
    </Toast>
  ) : null

  if (whoami.error) {
    return (
      <>
        <PageHead title="账户" />
        <PageBody>
          <ReadErrorCard
            title="无法读取登录状态"
            error={whoami.error}
            busy={whoami.loading}
            onRetry={reloadWhoami}
          />
        </PageBody>
        {toastNode}
      </>
    )
  }

  if (!whoami.data) {
    return (
      <>
        <PageHead title="账户" />
        <PageBody>
          <LoadingCard title="正在读取登录状态…" description="登录态由本机 ipc 提供。" />
        </PageBody>
        {toastNode}
      </>
    )
  }

  if (whoami.data.authenticated) {
    return (
      <>
        <AccountsPanel
          auth={whoami.data}
          sessionBusy={sessionBusy}
          onLogout={handleLogout}
          onSessionLost={handleSessionLost}
          showToast={showToast}
        />
        {toastNode}
      </>
    )
  }

  return (
    <>
      <PageHead title="账户" />
      <PageBody>
        <LoginCard busy={sessionBusy} onLogin={handleLogin} />
      </PageBody>
      {toastNode}
    </>
  )
}
