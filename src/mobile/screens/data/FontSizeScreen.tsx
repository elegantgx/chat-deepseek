import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from '../../app/navigation.js'
import { useToast } from '../../app/toast.js'
import { getSettings, updatePreferences } from '../../../services/api/server.js'
import { Page, Switch, TopBar } from '../../ui/index.js'
import { FONT_SIZE_LEVELS, FontSlider } from './FontSlider.js'
import { useDataStrings } from './strings.js'
import styles from './FontSize.module.css'

/** 字号档位倍率：标准是 1；最大 1.3 与架构文档里的 1.3× 压缩验收一致 */
const SCALES = [0.85, 1, 1.1, 1.2, 1.3]

const readLevel = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < FONT_SIZE_LEVELS
    ? value
    : 1

const readFollow = (value: unknown): boolean => (typeof value === 'boolean' ? value : true)

/**
 * 字体大小（#34）：预览区 + 底部面板 + 滑轨 + 跟随系统开关。
 *
 * 现有浏览器设置没有字号项，所以把 `fontSize` / `fontFollowSystem` 作为额外键写进
 * `/api/v1/settings` 的 preferences（读取时保留整份对象，避免把语言、主题覆盖掉）。
 * 渲染层通过 `--mobile-font-scale` 暴露给所有界面；本屏的预览区立即按它排版。
 * 跟随系统时没有可读取的系统字号（WebView 不投影），按要求回落到标准档。
 */
export const FontSizeScreen = () => {
  const t = useDataStrings()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [level, setLevel] = useState(1)
  const [followSystem, setFollowSystem] = useState(true)
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
        const follow = readFollow(server.preferences.fontFollowSystem)
        setFollowSystem(follow)
        // 跟随系统时滑轨回到标准档，和示意的默认状态一致
        setLevel(follow ? 1 : readLevel(server.preferences.fontSize))
      })
      .catch(() => {
        // 读不到就保留标准档；用户拖动时再读一次整份偏好做合并
      })
    return () => {
      cancelled = true
    }
  }, [])

  const scale = followSystem ? 1 : SCALES[level]
  useEffect(() => {
    // 不清理：设置属于整个应用，离开本屏后预览之外的界面仍可消费这个变量
    document.documentElement.style.setProperty('--mobile-font-scale', String(scale))
  }, [scale])

  const persist = (nextLevel: number, nextFollow: boolean) => {
    saveQueue.current = saveQueue.current
      .then(async () => {
        const base = preferences.current ?? (await getSettings()).preferences
        const saved = await updatePreferences({
          ...base,
          fontSize: nextLevel,
          fontFollowSystem: nextFollow,
        })
        preferences.current = saved.preferences
      })
      .catch(() => {
        showToast(t.fontSizeSaveFailed)
      })
  }

  const changeLevel = (next: number) => {
    setLevel(next)
    if (followSystem) {
      // 手动拖滑轨意味着不再跟随系统，否则拖动没有反馈
      setFollowSystem(false)
      persist(next, false)
    } else {
      persist(next, false)
    }
  }

  const changeFollow = (next: boolean) => {
    setFollowSystem(next)
    if (next) {
      setLevel(1)
      persist(1, true)
    } else {
      persist(level, false)
    }
  }

  const labels = [
    t.fontSizeSmall,
    t.fontSizeStandard,
    t.fontSizeLarge,
    t.fontSizeXLarge,
    t.fontSizeXXLarge,
  ]
  const previewStyle = { '--font-scale': String(scale) } as CSSProperties

  return (
    <Page tone="group">
      <TopBar title={t.fontSizeTitle} onBack={() => navigate('settings')} />
      <div className={styles.preview} style={previewStyle}>
        <div className={styles.bubble}>{t.fontSizePreviewBubble}</div>
        <p className={styles.text}>{t.fontSizePreviewLine1}</p>
        <p className={styles.text}>{t.fontSizePreviewLine2}</p>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelRow}>
          <span>{t.fontSizeFollow}</span>
          <Switch checked={followSystem} onChange={changeFollow} label={t.fontSizeFollow} />
        </div>
        <div className={styles.sliderBlock}>
          <div className={styles.labels}>
            <span className={styles.aSmall}>A</span>
            <span className={styles.value} style={{ left: `${level * 25}%` }}>
              {labels[level]}
            </span>
            <span className={styles.aLarge}>A</span>
          </div>
          <FontSlider value={level} onChange={changeLevel} label={t.fontSizeSliderLabel} />
        </div>
      </div>
    </Page>
  )
}
