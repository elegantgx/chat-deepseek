import { useEffect, useState } from 'react'
import { useNavigate, useRoute } from '../../../app/navigation.js'
import { useHost, useReady } from '../../../app/runtime.js'
import { useToast } from '../../../app/toast.js'
import { Button, Card, Notice, Page, PageBody, TextField, TopBar } from '../../../ui/index.js'
import { useStrings } from '../../strings.js'
import { localStrings } from '../strings.js'
import { compactPath } from '../shared/format.js'
import { resolveFrom } from '../shared/navigation.js'
import { useAliveRef } from '../shared/useAliveRef.js'
import { useLocalServer } from '../shared/useLocalServer.js'
import type { ConfigProjection } from '../shared/useLocalServer.js'
import styles from './ServerHostScreen.module.css'

/**
 * 26 主机参数（visual §7 #26）：监听只读、API 地址、目录。
 *
 * 可写字段按 `docs/ipc.md` §4.20 的 `config.set` 只提交改过的项：listen 在 App 内不可改，
 * backupDir 留空等于清除配置（回落到 `<dataDir>/backups`），apiOrigin 不能为空。
 * 保存按钮在“没有改动 / 地址为空 / 保存中”时禁用；主按钮禁用仍是品牌色 45%。
 *
 * 只读的数据目录显示末两段（与状态卡一致）；可编辑的备份目录必须显示完整绝对路径，
 * 否则用户保存的会是一个非法相对路径。
 */
export const ServerHostScreen = () => {
  const t = useStrings(localStrings)
  const navigate = useNavigate()
  const route = useRoute()
  const host = useHost()
  const ready = useReady()
  const { showToast } = useToast()
  const { status, config, loading } = useLocalServer()
  const [baseline, setBaseline] = useState<ConfigProjection | null>(null)
  const [apiOrigin, setApiOrigin] = useState('')
  const [backupDir, setBackupDir] = useState('')
  const [saving, setSaving] = useState(false)
  const aliveRef = useAliveRef()

  const back = resolveFrom(route.params.get('from'), 'server-local')
  const listen = status?.listen ?? config?.listen ?? ''
  const dataDir = config?.dataDir ?? ready.dataDir

  // 只初始化一次草稿：后续用户编辑期间即使 hook 再刷新，也不覆盖输入
  useEffect(() => {
    if (baseline !== null || config === null) {
      return
    }
    setBaseline(config)
    setApiOrigin(config.apiOrigin)
    setBackupDir(config.backupDir)
  }, [baseline, config])

  const trimmedApi = apiOrigin.trim()
  const trimmedBackup = backupDir.trim()
  const dirty =
    baseline !== null && (trimmedApi !== baseline.apiOrigin || trimmedBackup !== baseline.backupDir)
  const canSave = baseline !== null && dirty && trimmedApi !== '' && !saving

  const handleSave = async () => {
    if (!canSave || baseline === null) {
      return
    }
    const patch: Record<string, string> = {}
    if (trimmedApi !== baseline.apiOrigin) {
      patch.apiOrigin = trimmedApi
    }
    if (trimmedBackup !== baseline.backupDir) {
      patch.backupDir = trimmedBackup
    }
    if (Object.keys(patch).length === 0) {
      return
    }
    setSaving(true)
    try {
      const next = (await host.request('config.set', patch)) as ConfigProjection
      if (!aliveRef.current) {
        return
      }
      setBaseline(next)
      setApiOrigin(next.apiOrigin)
      setBackupDir(next.backupDir)
      showToast(t.saved)
    } catch {
      // 校验错误也走这里：保留用户输入，toast 说明后可以改完再点保存
      if (aliveRef.current) {
        showToast(t.actionFailed)
      }
    } finally {
      if (aliveRef.current) {
        setSaving(false)
      }
    }
  }

  const unavailable = !loading && config === null

  return (
    <Page>
      <TopBar title={t.hostTitle} onBack={() => navigate(back)} />
      <PageBody pad="server">
        {unavailable ? (
          <Notice tone="error">{t.configLoadFailed}</Notice>
        ) : (
          <>
            <Card padding="form">
              <TextField label={t.listenLabel} value={listen} readOnly mono hint={t.listenHint} />
              <TextField
                label={t.apiLabel}
                value={apiOrigin}
                onChange={(event) => setApiOrigin(event.target.value)}
                mono
                hint={t.apiHint}
              />
            </Card>

            <Card padding="form" gap={12}>
              <TextField
                label={t.dataDirLabel}
                value={compactPath(dataDir, 2)}
                readOnly
                mono
                hint={t.dataDirHint}
              />
              <TextField
                label={t.backupDirLabel}
                value={backupDir}
                onChange={(event) => setBackupDir(event.target.value)}
                mono
                hint={t.backupDirHint}
              />
            </Card>

            <Button
              variant="primary"
              block
              loading={saving}
              disabled={!canSave}
              className={styles.save}
              onClick={handleSave}
            >
              {t.save}
            </Button>
          </>
        )}
      </PageBody>
    </Page>
  )
}
