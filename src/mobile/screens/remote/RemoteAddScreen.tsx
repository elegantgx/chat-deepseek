import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useRoute } from '../../app/navigation.js'
import { useHost, useIsMock, useReady } from '../../app/runtime.js'
import { Button, Card, Notice, Page, PageBody, TextField, TopBar } from '../../ui/index.js'
import {
  addRemoteServer,
  normalizeRemoteAddress,
  probeRemote,
  selectRemoteServer,
  useRemoteServers,
  validateRemoteAddress,
} from './data.js'
import { PrepRow } from './parts.js'
import { useRemoteStrings } from './strings.js'
import styles from './RemoteAddScreen.module.css'

/**
 * 14 添加远程服务器 / 15 连接失败。
 *
 * 两屏共用组件：15 只是 14 的字段错误态（visual §7.1 规定状态屏不是独立路由），
 * 由路由 id 决定首帧是否直接展示错误；用户改地址会清掉旧错误，避免「一进页面就标红」。
 * 证书失败单独走整块提示，不把地址框标红——地址本身没错，是证书链不受信任。
 */

type FieldErrorKind = 'network' | 'http' | 'protocol' | 'https' | 'invalid' | 'unknown'

interface FieldError {
  kind: FieldErrorKind
  status?: number
}

interface NoticeState {
  kind: 'tls' | 'switch' | 'add'
}

/** 地址错误的展示顺序：先指出格式，再指出网络；status 只对 http 有意义 */
const errorText = (error: FieldError, text: ReturnType<typeof useRemoteStrings>): string => {
  switch (error.kind) {
    case 'https':
      return text.errorHttps
    case 'invalid':
      return text.errorInvalid
    case 'protocol':
      return text.errorProtocol
    case 'http':
      return typeof error.status === 'number'
        ? text.errorHttp.replace('{status}', String(error.status))
        : text.errorNetwork
    default:
      return text.errorNetwork
  }
}

const noticeText = (notice: NoticeState, text: ReturnType<typeof useRemoteStrings>): string => {
  switch (notice.kind) {
    case 'tls':
      return text.errorTls
    case 'add':
      return text.errorAdd
    default:
      return text.errorSwitch
  }
}

export const RemoteAddScreen = () => {
  const route = useRoute()
  const ready = useReady()
  const host = useHost()
  const mock = useIsMock()
  const navigate = useNavigate()
  const text = useRemoteStrings()
  const { servers } = useRemoteServers()

  // 浏览器 fake 中没有「上一次输入」，用 ready 里的远程地址当填写态；
  // 真壳从空表单开始。这样截图能覆盖示意里的已填写状态，又不会改产品逻辑。
  const firstRemote = ready.servers.find((server) => server.kind === 'remote')
  const forcedFailed = route.screen === 'server-remote-add-failed'
  const [address, setAddress] = useState(
    route.params.get('baseUrl') ?? (mock && firstRemote ? firstRemote.baseUrl : '')
  )
  const [fieldError, setFieldError] = useState<FieldError | null>(
    forcedFailed ? { kind: 'network' } : null
  )
  const [notice, setNotice] = useState<NoticeState | null>(
    route.params.get('error') === 'tls' ? { kind: 'tls' } : null
  )
  const [pending, setPending] = useState(false)

  // 同一个组件被两个路由 id 复用；从 14 切到 15 时要能重新落到错误态。
  useEffect(() => {
    if (!forcedFailed) {
      return
    }
    setFieldError({ kind: 'network' })
    setNotice(null)
  }, [forcedFailed])

  const handleAddressChange = (value: string) => {
    setAddress(value)
    setFieldError(null)
    setNotice(null)
  }

  const submit = async () => {
    if (pending) {
      return
    }
    const baseUrl = normalizeRemoteAddress(address)
    // 校验前就把输入框里的尾斜杠收掉，失败后重试看到的是同一份规范化地址。
    setAddress(baseUrl)
    if (!baseUrl) {
      setFieldError({ kind: 'invalid' })
      return
    }
    const validation = validateRemoteAddress(baseUrl)
    if (validation !== 'ok') {
      setFieldError({ kind: validation })
      return
    }

    setPending(true)
    setFieldError(null)
    setNotice(null)
    try {
      const result = await probeRemote(host, baseUrl)
      if (!result.ok) {
        if (result.failure === 'tls') {
          setNotice({ kind: 'tls' })
        } else {
          setFieldError({
            kind: result.failure === 'unknown' ? 'network' : result.failure,
            ...(result.status !== undefined ? { status: result.status } : {}),
          })
        }
        return
      }

      // 探测可能返回规范化后的地址；去重和加入都以它为准。
      const resolved = normalizeRemoteAddress(result.baseUrl || baseUrl)
      const existing = servers.find(
        (server) => server.kind === 'remote' && normalizeRemoteAddress(server.baseUrl) === resolved
      )
      let target = existing ?? null
      if (!target) {
        try {
          target = await addRemoteServer(host, resolved)
        } catch {
          setNotice({ kind: 'add' })
          return
        }
      }
      if (!target) {
        setNotice({ kind: 'add' })
        return
      }

      const selected = await selectRemoteServer(host, target.id)
      if (!selected) {
        setNotice({ kind: 'switch' })
        return
      }
      setAddress(resolved)
      navigate('server-remote-login', { serverId: target.id, baseUrl: target.baseUrl })
      // `net` 桥在启动时快照了 selectedId；选择落盘后必须重载，登录请求才会打到新服务器。
      // 先写 hash 再重载，重载后仍停在登录页。
      window.location.reload()
    } finally {
      setPending(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  const message = fieldError ? errorText(fieldError, text) : undefined

  return (
    <Page tone="group">
      <TopBar title={text.addTitle} onBack={() => navigate('server-picker')} />
      <PageBody pad="server">
        <form onSubmit={handleSubmit} noValidate>
          <Card padding="form">
            <TextField
              label={text.addressLabel}
              value={address}
              onChange={(event) => handleAddressChange(event.target.value)}
              hint={text.addressHint}
              error={message}
              placeholder={text.addressPlaceholder}
              mono
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={pending}
            />
          </Card>

          {notice ? (
            <div className={styles.noticeGroup}>
              <Notice tone="error">{noticeText(notice, text)}</Notice>
            </div>
          ) : null}

          <Button block type="submit" loading={pending} className={styles.submit}>
            {text.testConnection}
          </Button>
        </form>

        <Card label={text.prepare} gap={28}>
          <PrepRow>{text.prepareServer}</PrepRow>
          <PrepRow>{text.prepareAccount}</PrepRow>
        </Card>
      </PageBody>
    </Page>
  )
}
