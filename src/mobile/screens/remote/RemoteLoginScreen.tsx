import { useEffect, useState } from 'react'
import type { ChangeEventHandler, FormEvent } from 'react'
import { useNavigate, useRoute } from '../../app/navigation.js'
import { useHost, useIsMock } from '../../app/runtime.js'
import { ApiError } from '../../../services/api/client.js'
import { login } from '../../../services/api/server.js'
import { Button, Card, Page, PageBody, TopBar } from '../../ui/index.js'
import { selectRemoteServer, useRemoteServers } from './data.js'
import { ServerChip } from './parts.js'
import { useRemoteStrings } from './strings.js'
import styles from './RemoteLoginScreen.module.css'

/**
 * 16 远程登录 / 17 凭据错误。
 *
 * 服务端对凭据错误只回一句「用户名或密码错误」，指不出是哪一个字段，所以两个框一起
 * 标红、错误行只写一句（visual §5.3）。chip 在任何失败下都保持「已连接」：网络断了
 * 也不会把服务器标签改成红色，错误只属于这次登录。
 *
 * 登录走 `src/services/api/server.ts` 的 `login()`，底层是替换过的 fetch，和浏览器
 * 是同一条 `/api/v1/auth/login` 路径；不在这里另开直连。
 */

type LoginErrorKind = 'credentials' | 'empty' | 'network' | 'unknown'

interface LoginError {
  kind: LoginErrorKind
}

export const RemoteLoginScreen = () => {
  const route = useRoute()
  const host = useHost()
  const mock = useIsMock()
  const navigate = useNavigate()
  const text = useRemoteStrings()
  const { servers, selectedId } = useRemoteServers()

  const paramId = route.params.get('serverId')
  // 有参数时只认这一台：服务器被删掉后不能退而求其次显示另一台，
  // 否则会把账户密码发到用户没选中的服务器上。只有直接打开 16 才按当前选择兜底。
  const server = paramId
    ? servers.find((item) => item.kind === 'remote' && item.id === paramId)
    : (servers.find((item) => item.kind === 'remote' && item.id === selectedId) ??
      servers.find((item) => item.kind === 'remote'))

  const forcedError = route.screen === 'server-remote-login-error'
  // 浏览器 fake 的 `remote-connected` 里已有一份固定账户；预填只为覆盖示意的填写态，
  // 真壳从空表单开始，交给用户输入。密码长度 8，正好是示意里的 8 个点。
  const [username, setUsername] = useState(mock ? 'gx' : '')
  const [password, setPassword] = useState(mock ? 'demo1234' : '')
  const [error, setError] = useState<LoginError | null>(
    forcedError ? { kind: 'credentials' } : null
  )
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!forcedError) {
      return
    }
    setError({ kind: 'credentials' })
  }, [forcedError])

  const clearError = () => {
    if (error) {
      setError(null)
    }
  }

  const submit = async () => {
    if (!server || pending) {
      return
    }
    const name = username.trim()
    if (!name || !password) {
      setError({ kind: 'empty' })
      return
    }

    setPending(true)
    setError(null)
    try {
      // 数据面按启动时选中的服务器发请求；若当前路由指向另一台，先落选择再重载，
      // 否则登录会悄悄打到旧的服务器上。正常流程（14 → 16）这里永远相等。
      if (server.id !== selectedId) {
        const selected = await selectRemoteServer(host, server.id)
        if (selected) {
          window.location.reload()
          return
        }
        setError({ kind: 'unknown' })
        return
      }

      await login(name, password)
      // 登录已经成功，选择持久化失败也不该把用户留在登录页；这里只是按产品流程再确认一次。
      await selectRemoteServer(host, server.id)
      navigate('chat-welcome')
    } catch (failure) {
      if (failure instanceof ApiError) {
        if (failure.status === 401 || failure.status === 400) {
          setError({ kind: 'credentials' })
        } else if (failure.kind === 'network') {
          setError({ kind: 'network' })
        } else {
          setError({ kind: 'unknown' })
        }
      } else {
        setError({ kind: 'unknown' })
      }
    } finally {
      setPending(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  const goBack = () => {
    if (server) {
      navigate('server-remote-add', { baseUrl: server.baseUrl })
      return
    }
    navigate('server-remote-add')
  }

  if (!server) {
    return (
      <Page tone="bg">
        <TopBar title="" onBack={goBack} />
        <PageBody pad="login">
          <h1 className={styles.title}>{text.loginTitle}</h1>
          <Card padding="form" className={styles.missing}>
            <p className={styles.missingText}>{text.serverMissing}</p>
            <Button block onClick={() => navigate('server-remote-add')}>
              {text.addServer}
            </Button>
          </Card>
        </PageBody>
      </Page>
    )
  }

  const marksFields = error?.kind === 'credentials'
  const errorMessage =
    error === null
      ? null
      : error.kind === 'credentials'
        ? text.errorCredentials
        : error.kind === 'empty'
          ? text.errorEmptyCredentials
          : error.kind === 'network'
            ? text.errorLoginNetwork
            : text.errorLoginUnknown

  return (
    <Page tone="bg">
      {/* 登录页的 appbar 只有返回键，标题在内容区里单独放大，所以顶栏标题留空 */}
      <TopBar title="" onBack={goBack} />
      <PageBody pad="login">
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <h1 className={styles.title}>{text.loginTitle}</h1>

          <ServerChip baseUrl={server.baseUrl} status={text.connected} />

          <div className={styles.fields}>
            <PillField
              value={username}
              onChange={(value) => {
                setUsername(value)
                clearError()
              }}
              placeholder={text.usernamePlaceholder}
              autoComplete="username"
              invalid={marksFields}
              disabled={pending}
            />
            <PillField
              type="password"
              value={password}
              onChange={(value) => {
                setPassword(value)
                clearError()
              }}
              placeholder={text.passwordPlaceholder}
              autoComplete="current-password"
              invalid={marksFields}
              disabled={pending}
            />
          </div>

          {errorMessage ? <p className={styles.formError}>{errorMessage}</p> : null}

          <Button
            block
            size="page"
            type="submit"
            loading={pending}
            className={`${styles.submit}${errorMessage ? ` ${styles.submitAfterError}` : ''}`}
          >
            {text.loginSubmit}
          </Button>

          <p className={styles.note}>{text.loginNote}</p>
        </form>
      </PageBody>
    </Page>
  )
}

interface PillFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoComplete: string
  invalid: boolean
  disabled: boolean
  type?: 'text' | 'password'
}

/**
 * 登录页的 56 高胶囊输入。
 *
 * 没有复用 `ui/TextField`：它一次只能给一个字段挂错误文案，而远程登录要把两个框同时
 * 标红、只在下方出一行错误。这里按同一份尺寸（56 / 28 / `--fill-2` / 17）重画，
 * 红圈用内描边，不改变控件尺寸。
 */
const PillField = ({
  value,
  onChange,
  placeholder,
  autoComplete,
  invalid,
  disabled,
  type = 'text',
}: PillFieldProps) => {
  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    onChange(event.target.value)
  }
  return (
    <div className={`${styles.pillField}${invalid ? ` ${styles.pillFieldError}` : ''}`}>
      <input
        className={`${styles.pillInput}${type === 'password' ? ` ${styles.password}` : ''}`}
        type={type}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid || undefined}
      />
    </div>
  )
}
