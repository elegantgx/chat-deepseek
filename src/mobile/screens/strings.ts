import { useSettings } from '../../services/settings.js'

/**
 * 并行开发期的临时落脚点。
 *
 * 36 屏由多个 agent 同时写，如果他们各自去改 `src/i18n/{zh,en}.ts`，最后一定互相覆盖。
 * 所以屏组的文案先写在自己的 `strings.ts` 里（zh 为 key 源头，en 必须同 key）。
 * 首版保留了这层脚手架：双语完整、类型对齐，但还没并进 `src/i18n/{zh,en}.ts`；
 * 迁移是机械工作，列为后续。迁移前新增文案仍要 zh/en 两边同步。
 */
export interface ScreenStrings<T extends Record<string, string> = Record<string, string>> {
  zh: T
  en: { [K in keyof T]: string }
}

export const useStrings = <T extends Record<string, string>>(bundle: ScreenStrings<T>): T => {
  const locale = useSettings((state) => state.locale)
  return (locale === 'en-US' ? bundle.en : bundle.zh) as T
}
