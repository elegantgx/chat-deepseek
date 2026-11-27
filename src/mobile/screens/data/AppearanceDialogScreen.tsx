import { useState } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { setThemePreference, useSettings } from '../../../services/settings.js'
import type { ThemePreference } from '../../../services/settings.js'
import { ChoiceDialog } from '../../ui/index.js'
import { SettingsScreen } from '../account/SettingsScreen.js'
import { useDataStrings } from './strings.js'

/**
 * 外观（#35）：系统 / 浅色 / 深色单选弹窗。
 *
 * 选中即写 `useSettings.themePreference`，Shell 订阅后立即换主题；
 * 确认只负责关掉弹窗——这一步仍然是真实写入，避免“确认”变成纯导航。
 */
export const AppearanceDialogScreen = () => {
  const t = useDataStrings()
  const navigate = useNavigate()
  const current = useSettings((state) => state.themePreference)
  const [selected, setSelected] = useState<ThemePreference>(current)

  const options: Array<{ value: ThemePreference; label: string }> = [
    { value: 'system', label: t.themeSystem },
    { value: 'light', label: t.themeLight },
    { value: 'dark', label: t.themeDark },
  ]

  return (
    <>
      <SettingsScreen />
      <ChoiceDialog
        open
        title={t.settingsAppearance}
        options={options}
        value={selected}
        onSelect={(value) => {
          const next: ThemePreference = value === 'light' || value === 'dark' ? value : 'system'
          setSelected(next)
          setThemePreference(next)
        }}
        confirmLabel={t.confirm}
        onConfirm={() => {
          setThemePreference(selected)
          navigate('settings')
        }}
        onCancel={() => navigate('settings')}
      />
    </>
  )
}
