import { create } from 'zustand'
import {
  clearApiKey as clearServerApiKey,
  getSettings,
  saveApiKey as saveServerApiKey,
  updatePreferences,
} from './api/server.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 用户设置保存在服务端。apiKey 不再进入浏览器，
 * hasApiKey 只表示服务端是否已配置，界面据此显示掩码和引导。
 */
type Settings = {
  hasApiKey: boolean
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /**
   * 服务端 preferences 里本端不认识的键（Android 的字号/语言偏好等）。
   * 保存设置时原样带回，否则改一次主题就会把别的端的偏好抹掉。
   */
  extraPreferences: Record<string, unknown>
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => (isChineseBrowser() ? 'zh-CN' : 'en-US')

/** 未保存过时跟随系统 */
export const useSettings = create<Settings>(() => ({
  hasApiKey: false,
  locale: initialLocale(),
  themePreference: 'system',
  location: null,
  ttsVoice: 'stella',
  thinking: false,
  search: false,
  siderCollapsed: false,
  extraPreferences: {},
}))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

/** 只接受已知字段；旧版本或未来版本多出来的字段忽略，缺失字段保留当前值。 */
const applyPreferences = (value: unknown) => {
  if (!isRecord(value)) {
    return
  }
  const update: Partial<Settings> = {}
  if (value.locale === 'zh-CN' || value.locale === 'en-US') {
    update.locale = value.locale
  }
  if (
    value.themePreference === 'light' ||
    value.themePreference === 'dark' ||
    value.themePreference === 'system'
  ) {
    update.themePreference = value.themePreference
  }
  if (value.ttsVoice === 'stella' || value.ttsVoice === 'tide') {
    update.ttsVoice = value.ttsVoice
  }
  if ('location' in value) {
    update.location = normalizeLocation(value.location)
  }
  const thinking = bool(value.thinking)
  if (thinking !== undefined) {
    update.thinking = thinking
  }
  const search = bool(value.search)
  if (search !== undefined) {
    update.search = search
  }
  const siderCollapsed = bool(value.siderCollapsed)
  if (siderCollapsed !== undefined) {
    update.siderCollapsed = siderCollapsed
  }
  // 未知键原样留着：桌面端不认识 fontSize 之类的键，但保存时不能把它们删掉。
  update.extraPreferences = Object.fromEntries(
    Object.entries(value).filter(([key]) => !KNOWN_PREFERENCE_KEYS.has(key))
  )
  if (Object.keys(update).length > 0) {
    useSettings.setState(update)
  }
}

/** 登录后从服务端加载设置；失败时保留默认值，由调用方决定是否阻断界面。 */
export const loadSettings = async (): Promise<void> => {
  const server = await getSettings()
  applyPreferences(server.preferences)
  useSettings.setState({ hasApiKey: server.hasApiKey })
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false
let pending = false

const KNOWN_PREFERENCE_KEYS = new Set([
  'locale',
  'themePreference',
  'location',
  'ttsVoice',
  'thinking',
  'search',
  'siderCollapsed',
])

const preferencesSnapshot = () => {
  const {
    locale,
    themePreference,
    location,
    ttsVoice,
    thinking,
    search,
    siderCollapsed,
    extraPreferences,
  } = useSettings.getState()
  return {
    ...extraPreferences,
    locale,
    themePreference,
    location,
    ttsVoice,
    thinking,
    search,
    siderCollapsed,
  }
}

const flushPreferences = async () => {
  if (!pending || saving) {
    return
  }
  pending = false
  saving = true
  try {
    await updatePreferences(preferencesSnapshot())
  } catch {
    // 网络失败时保留内存设置；下一次修改会再次提交，避免打断使用。
  } finally {
    saving = false
    if (pending) {
      schedulePreferencesSave()
    }
  }
}

const schedulePreferencesSave = () => {
  pending = true
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushPreferences()
  }, 250)
}

const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
  useSettings.setState({ [key]: value } as Pick<Settings, K>)
  schedulePreferencesSave()
}

export const setLocale = (locale: Locale) => updateSetting('locale', locale)

export const setLocation = (value: UserLocation | null) =>
  updateSetting('location', normalizeLocation(value))

export const setThemePreference = (themePreference: ThemePreference) =>
  updateSetting('themePreference', themePreference)

export const setTtsVoice = (ttsVoice: TtsVoice) => updateSetting('ttsVoice', ttsVoice)

/** API Key 只上传到服务端加密保存，本地不保留明文。 */
export const setApiKey = async (apiKey: string | null): Promise<void> => {
  if (apiKey) {
    await saveServerApiKey(apiKey)
    useSettings.setState({ hasApiKey: true })
  } else {
    await clearServerApiKey()
    useSettings.setState({ hasApiKey: false })
  }
}

export const setThinking = (thinking: boolean) => updateSetting('thinking', thinking)

export const setSearch = (search: boolean) => updateSetting('search', search)

export const setSiderCollapsed = (siderCollapsed: boolean) =>
  updateSetting('siderCollapsed', siderCollapsed)
