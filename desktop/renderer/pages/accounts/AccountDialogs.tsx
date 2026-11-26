import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import type { AccountRow } from '../../app/ipc-types'
import { Button, Dialog, Field, Segmented } from '../../ui'
import type { SegmentedOption } from '../../ui'
import styles from './dialogs.module.css'

export type AddAccountRole = 'User' | 'Admin'

export interface AddAccountValues {
  username: string
  password: string
  role: AddAccountRole
}

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

const ROLE_OPTIONS: ReadonlyArray<SegmentedOption<AddAccountRole>> = [
  { value: 'User', label: '成员' },
  { value: 'Admin', label: '管理员' },
]

interface AddErrors {
  username?: string
  password?: string
}

interface AddAccountDialogProps {
  open: boolean
  busy: boolean
  existingUsernames: readonly string[]
  onClose: () => void
  onSubmit: (values: AddAccountValues) => void
}

export function AddAccountDialog({
  open,
  busy,
  existingUsernames,
  onClose,
  onSubmit,
}: AddAccountDialogProps) {
  const formId = useId()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AddAccountRole>('User')
  const [errors, setErrors] = useState<AddErrors>({})

  // 每次打开都从空白开始，避免上一次的输入和错误残留
  useEffect(() => {
    if (!open) {
      return
    }
    setUsername('')
    setPassword('')
    setRole('User')
    setErrors({})
  }, [open])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) {
      return
    }
    const name = username.trim()
    const next: AddErrors = {}
    if (!name) {
      next.username = '请输入用户名'
    } else if (!USERNAME_PATTERN.test(name)) {
      next.username = '用户名只能包含字母、数字或 . _ -（1–64 位）'
    } else if (existingUsernames.some((item) => item.toLowerCase() === name.toLowerCase())) {
      next.username = '用户名已存在'
    }
    if (!password) {
      next.password = '请输入初始密码'
    } else if (password.length < 8) {
      next.password = '初始密码至少 8 位'
    } else if (password.length > 1024) {
      next.password = '密码不能超过 1024 位'
    }
    if (next.username || next.password) {
      setErrors(next)
      return
    }
    onSubmit({ username: name, password, role })
  }

  return (
    <Dialog
      open={open}
      title="添加用户"
      description="新账户可以登录 Web 端和 GUI。"
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button tone="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button tone="primary" type="submit" form={formId} disabled={busy}>
            {busy ? '添加中…' : '添加'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field
          label="用户名"
          value={username}
          onChange={(value) => {
            setUsername(value)
            if (errors.username) {
              setErrors((prev) => ({ ...prev, username: undefined }))
            }
          }}
          placeholder="例如 alice"
          autoComplete="off"
          fullWidth
          disabled={busy}
          error={errors.username}
        />
        <Field
          label="初始密码"
          type="password"
          value={password}
          onChange={(value) => {
            setPassword(value)
            if (errors.password) {
              setErrors((prev) => ({ ...prev, password: undefined }))
            }
          }}
          placeholder="输入密码"
          autoComplete="new-password"
          fullWidth
          disabled={busy}
          error={errors.password}
          hint={errors.password ? undefined : '至少 8 位'}
        />
        <div className={styles.roleGroup}>
          <span className={styles.roleLabel}>角色</span>
          <Segmented
            label="角色"
            options={ROLE_OPTIONS.map((option) => ({ ...option, disabled: busy }))}
            value={role}
            width={332}
            onChange={(next) => {
              if (!busy) {
                setRole(next)
              }
            }}
          />
        </div>
      </form>
    </Dialog>
  )
}

interface PasswordErrors {
  password?: string
  confirm?: string
}

interface ChangePasswordDialogProps {
  open: boolean
  account: AccountRow | null
  busy: boolean
  onClose: () => void
  onSubmit: (password: string) => void
}

export function ChangePasswordDialog({
  open,
  account,
  busy,
  onClose,
  onSubmit,
}: ChangePasswordDialogProps) {
  const formId = useId()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<PasswordErrors>({})
  const accountId = account?.id

  useEffect(() => {
    if (!open) {
      return
    }
    setPassword('')
    setConfirm('')
    setErrors({})
  }, [open, accountId])

  if (!open || !account) {
    return null
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) {
      return
    }
    const next: PasswordErrors = {}
    if (!password) {
      next.password = '请输入新密码'
    } else if (password.length < 8) {
      next.password = '新密码至少 8 位'
    } else if (password.length > 1024) {
      next.password = '密码不能超过 1024 位'
    }
    if (!confirm) {
      next.confirm = '请再次输入新密码'
    } else if (confirm !== password) {
      next.confirm = '两次输入的密码不一致'
    }
    if (next.password || next.confirm) {
      setErrors(next)
      return
    }
    onSubmit(password)
  }

  return (
    <Dialog
      open
      title="修改密码"
      description={`为账户 “${account.username}” 设置新密码。`}
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button tone="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button tone="primary" type="submit" form={formId} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field
          label="新密码"
          type="password"
          value={password}
          onChange={(value) => {
            setPassword(value)
            if (errors.password || errors.confirm) {
              setErrors((prev) => ({ ...prev, password: undefined, confirm: undefined }))
            }
          }}
          placeholder="输入密码"
          autoComplete="new-password"
          fullWidth
          disabled={busy}
          error={errors.password}
          hint={errors.password ? undefined : '至少 8 位'}
        />
        <Field
          label="确认密码"
          type="password"
          value={confirm}
          onChange={(value) => {
            setConfirm(value)
            if (errors.confirm) {
              setErrors((prev) => ({ ...prev, confirm: undefined }))
            }
          }}
          placeholder="再输入一次"
          autoComplete="new-password"
          fullWidth
          disabled={busy}
          error={errors.confirm}
        />
      </form>
    </Dialog>
  )
}

interface DeleteAccountDialogProps {
  open: boolean
  account: AccountRow | null
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}

export function DeleteAccountDialog({
  open,
  account,
  busy,
  onClose,
  onConfirm,
}: DeleteAccountDialogProps) {
  if (!open || !account) {
    return null
  }

  return (
    <Dialog
      open
      title="删除账户？"
      description={`账户 “${account.username}” 将被永久删除，无法恢复。`}
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button tone="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button tone="dangerSolid" disabled={busy} onClick={onConfirm}>
            {busy ? '删除中…' : '删除'}
          </Button>
        </>
      }
    />
  )
}
