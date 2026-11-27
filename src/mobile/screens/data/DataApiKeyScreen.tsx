import { useRef, useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useToast } from '../../app/toast.js'
import { ApiError, verifyApiKey } from '../../../services/api/client.js'
import { getMe } from '../../../services/api/server.js'
import { setApiKey } from '../../../services/settings.js'
import { Button, Notice, Page, PageBody, TextField, TopBar } from '../../ui/index.js'
import { useDataStrings } from './strings.js'
import styles from './DataApiKey.module.css'

/**
 * API Key（#31）：一个胶囊输入 + 确认。
 *
 * Key 永远不回显，输入即覆盖：这里用 password 输入、成功后不再展示任何内容。
 * 保存走 `services/settings` 的既有路径（先 `/settings/api-key/verify` 校验，
 * 再 `PUT /settings/api-key`），服务端只回 hasApiKey，不会把 Key 传回来。
 */
export const DataApiKeyScreen = () => {
  const t = useDataStrings()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionReady = useRef(false)

  const ensureSession = async () => {
    if (sessionReady.current) {
      return
    }
    const session = await getMe()
    if (!session) {
      throw new Error('session expired')
    }
    sessionReady.current = true
  }

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await ensureSession()
      await verifyApiKey(apiKey)
      await setApiKey(apiKey)
      showToast(t.apiKeySaved)
      navigate('data-manage')
    } catch (cause) {
      // 401/400 是“这个 Key 不能用”，网络类错误才让人检查网络
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 400)) {
        setError(t.apiKeyInvalid)
      } else {
        setError(t.apiKeyFailed)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page tone="group">
      <TopBar title={t.apiKeyTitle} onBack={() => navigate('data-manage')} />
      <PageBody pad="server">
        <TextField
          variant="pill"
          type="password"
          className={styles.field}
          value={value}
          placeholder={t.apiKeyPlaceholder}
          autoComplete="off"
          spellCheck={false}
          aria-label={t.apiKeyTitle}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              void submit()
            }
          }}
        />
        <Button
          size="page"
          block
          className={styles.submit}
          disabled={!value.trim()}
          loading={busy}
          onClick={() => void submit()}
        >
          {busy ? t.apiKeyVerifying : t.apiKeyConfirm}
        </Button>
        {error ? (
          <Notice tone="error" className={styles.notice}>
            {error}
          </Notice>
        ) : null}
      </PageBody>
    </Page>
  )
}
