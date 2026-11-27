import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useToast } from '../../app/toast.js'
import { getSettings, updatePreferences } from '../../../services/api/server.js'
import { useSettings } from '../../../services/settings.js'
import type { Locale } from '../../../services/settings.js'
import { ChoiceDialog, GlobeIcon } from '../../ui/index.js'
import { SettingsScreen } from '../account/SettingsScreen.js'
import { useDataStrings } from './strings.js'

type LocalePreference = Locale | 'system'

const isLocalePreference = (value: unknown): value is LocalePreference =>
  value === 'system' || value === 'zh-CN' || value === 'en-US'

/** 系统语言只在“系统”这一项上解析；中文环境优先，和浏览器登录页的默认一致 */
const systemLocale = (): Locale =>
  navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'

/**
 * 语言（#36）：系统 / 中文 / English，只有三项。
 *
 * 现有 `useSettings.locale` 只存解析后的语言（zh-CN/en-US），没有“系统”这一态；
 * 这里在服务端 preferences 里补一个 `localePreference` 标记，选择系统时仍把解析后的
 * 语言写进 `locale`，这样 `src/i18n` 和 Shell 的既有机制立即生效。
 */
export const LanguageDialogScreen = () => {
  const t = useDataStrings()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const locale = useSettings((state) => state.locale)
  const [selected, setSelected] = useState<LocalePreference>(locale)
  const preferences = useRef<Record<string, unknown> | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((server) => {
        if (cancelled) {
          return
        }
        preferences.current = server.preferences
        const saved = server.preferences.localePreference
        if (isLocalePreference(saved)) {
          setSelected(saved)
        }
      })
      .catch(() => {
        // 读不到偏好时保留当前语言作为选中项；用户仍可切换，保存会再读一次
      })
    return () => {
      cancelled = true
    }
  }, [])

  const persist = (preference: LocalePreference, resolved: Locale) => {
    saveQueue.current = saveQueue.current
      .then(async () => {
        const base = preferences.current ?? (await getSettings()).preferences
        const saved = await updatePreferences({
          ...base,
          locale: resolved,
          localePreference: preference,
        })
        preferences.current = saved.preferences
      })
      .catch(() => {
        showToast(t.languageSaveFailed)
      })
  }

  const options: Array<{ value: LocalePreference; label: string }> = [
    { value: 'system', label: t.languageSystem },
    { value: 'zh-CN', label: t.languageChinese },
    { value: 'en-US', label: t.languageEnglish },
  ]

  const select = (next: LocalePreference) => {
    const resolved = next === 'system' ? systemLocale() : next
    setSelected(next)
    // 直接写 store：与 setLocale 的最终效果一致，但不会触发只含旧字段的整份快照覆盖
    useSettings.setState({ locale: resolved })
    persist(next, resolved)
  }

  return (
    <>
      <SettingsScreen />
      <ChoiceDialog
        open
        title={t.settingsLanguage}
        icon={<GlobeIcon size={26} />}
        options={options}
        value={selected}
        onSelect={(value) => select(isLocalePreference(value) ? value : 'system')}
        confirmLabel={t.confirm}
        onConfirm={() => {
          const resolved = selected === 'system' ? systemLocale() : selected
          useSettings.setState({ locale: resolved })
          persist(selected, resolved)
          navigate('settings')
        }}
        onCancel={() => navigate('settings')}
      />
    </>
  )
}
