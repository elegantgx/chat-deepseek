#!/usr/bin/env node
/**
 * Android 截图回归：同一台机器、同一个 Chrome，把示意页与实现页各截一张，逐像素比较。
 *
 * 为什么必须同进程双渲染：仓库不锁 Chromium 版本，示意截图和实现截图如果分别来自
 * 不同版本/不同机器，字体与光栅化差异会淹没真正的布局差异。这里一次运行内先截示意、
 * 再截实现，版本漂移对两张图是同一份，天然抵消（docs/android-architecture.md §9）。
 *
 * 输出：
 * - tmp/shots/report.json：逐屏逐模式的 diff%、bbox、最差行列、结构判定；
 * - tmp/shots/pairs/*.png：示意/实现单图 + “左右并排 + 差异高亮”的对比图；
 * - 终端摘要。
 *
 * 退出码：0 全通过（含 skipped），1 有失败，2 用法错误。
 *
 * 已知限制（不是 bug，写进汇报让 CI 心里有数）：
 * - 没有装 fonts-noto-cjk 的机器上，示意与实现会一起变方框，diff 仍然稳定，
 *   但人就别想看了；CI 必须装。
 * - 动画靠 prefers-reduced-motion: reduce 冻结；不响应这条媒体查询的动画会导致
 *   “截图未稳定”的警告（报告里保留，不直接判失败）。
 * - 示意与实现若使用不同字体（系统 UI 字体 vs 打包字体），字宽/换行差异会体现为
 *   真实 diff；这是需要人看的信号，脚本不会替它开脱。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  captureStable,
  connectPage,
  detectChrome,
  evaluate,
  findFreePort,
  launchChrome,
  preparePage,
  readPageState,
  setSafeAreaInsets,
  setViewport,
} from './shots/chrome.mjs'
import {
  loadPlaceholderTexts,
  loadScreens,
  SCENARIO_IDS,
  SCREEN_ALLOWANCES,
  scenarioFor,
} from './shots/registry.mjs'
import { startStaticServer } from './shots/server.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const MOCKUP_DIR = path.join(REPO_ROOT, 'docs/android/mockups')
const DEFAULT_APP_DIR = path.join(REPO_ROOT, 'dist-mobile')
const BASELINE_DIR = path.join(MOCKUP_DIR, 'shots/impl')
const OUTPUT_DIR = path.join(REPO_ROOT, 'tmp/shots')
const PAIRS_DIR = path.join(OUTPUT_DIR, 'pairs')
const REPORT_PATH = path.join(OUTPUT_DIR, 'report.json')

const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
const EXPECTED_IMAGE = { width: 780, height: 1688 }
/** 示意页顶部假系统状态栏是 28 CSS px；默认把这段排除出 diff */
const DEFAULT_IGNORE_TOP = 28
/** 真机状态栏高度也是 28；实现页靠 env(safe-area-inset-top) 留白 */
const SAFE_AREA_INSETS = { top: 28, bottom: 0, left: 0, right: 0 }
const ZERO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 }
/** 单通道差 ≤ 8 视为噪声；与 canvas 里的 1px 邻域容差配合，放过抗锯齿 */
const PIXEL_TOLERANCE = 8
/** 成片差异默认阈值：占参与像素的 0.25%（780×1632 ≈ 3183px） */
const DEFAULT_MAX_SOLID = 0.25
const MOCKUP_SETTLE_MS = 200
/** fake host 固定延迟 240ms、fake net 120ms；首屏数据回来前截图会截到 loading */
const APP_SETTLE_MS = 900

const HELP = `用法: node scripts/shots.mjs [选项]

同一台机器、同一个 Chrome，把 docs/android/mockups/ 的示意页与 dist-mobile/ 的实现页
各截一张，逐像素比较并写出可判定的报告。默认明暗两轮都跑。

选项:
  --only=<id,id>          只跑指定屏；接受屏 id 或两位编号（01 或 1），逗号分隔
  --mode=light|dark|both  只跑明色 / 暗色 / 两轮（默认 both）
  --max-diff=<percent>    差异像素占比阈值，默认 0.5；超过即失败
  --max-solid=<percent>   成片差异（非抗锯齿）占参与像素的阈值，默认 0.25；
                          超过即失败。0 表示任何成片差异都失败（旧严格口径）
  --ignore-top=<css px>   比对时忽略顶部高度，默认 28（示意页的假系统状态栏）；
                          0 表示不忽略。图片本身不裁剪，只从 clamp 后的 y 开始算
  --update-baseline       额外把实现页截图写到 docs/android/mockups/shots/impl/
                          （明色 impl/<id>.png，暗色 impl/dark/<id>.png）；
                          默认不写 docs，基线只用于人工比对
  --scenario=<id>         覆盖所有屏的 fake 场景，可选:
                          ${SCENARIO_IDS.join(' / ')}
  --app-dir=<dir>         实现产物目录，默认 dist-mobile（可对比另一份构建）
  --mockup-as-impl        用示意页顶替实现页做自检；渲染链路稳定时 diff 应为 0.00%
  --chrome=<path>         指定 Chrome 可执行文件；默认在 PATH 里找 google-chrome/chromium
  --settle=<ms>           截图前额外稳定等待，覆盖默认值（示意 200 / 实现 900）
  --keep-chrome           跑完保留临时 Chrome profile（排错用）
  --verbose               打印 CDP、页面导航与等待细节
  --help, -h              显示本帮助

退出码: 0 全部通过（skipped 不算失败）；1 有 diff/结构/尺寸失败；2 用法错误。
报告: tmp/shots/report.json；对比图: tmp/shots/pairs/。
`

class UsageError extends Error {}

const parseArgs = (argv) => {
  const options = {
    mode: 'both',
    maxDiff: 0.5,
    maxSolid: DEFAULT_MAX_SOLID,
    ignoreTop: DEFAULT_IGNORE_TOP,
    only: [],
    updateBaseline: false,
    scenario: null,
    appDir: null,
    mockupAsImpl: false,
    chrome: null,
    settle: null,
    keepChrome: false,
    verbose: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (!arg.startsWith('--')) {
      throw new UsageError(`未知参数: ${arg}`)
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s)
    const readValue = (label) => {
      if (inline !== undefined) return inline
      const next = argv[++index]
      if (next === undefined) throw new UsageError(`${label} 需要一个值`)
      return next
    }
    switch (name) {
      case 'only':
        options.only.push(
          ...readValue('--only')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        )
        break
      case 'mode':
        options.mode = readValue('--mode')
        break
      case 'max-diff':
        options.maxDiff = Number(readValue('--max-diff'))
        break
      case 'max-solid':
        options.maxSolid = Number(readValue('--max-solid'))
        break
      case 'ignore-top':
        options.ignoreTop = Number(readValue('--ignore-top'))
        break
      case 'update-baseline':
        options.updateBaseline = true
        break
      case 'scenario':
        options.scenario = readValue('--scenario')
        break
      case 'app-dir':
        options.appDir = readValue('--app-dir')
        break
      case 'mockup-as-impl':
        options.mockupAsImpl = true
        break
      case 'chrome':
        options.chrome = readValue('--chrome')
        break
      case 'settle':
        options.settle = Number(readValue('--settle'))
        break
      case 'keep-chrome':
        options.keepChrome = true
        break
      case 'verbose':
        options.verbose = true
        break
      default:
        throw new UsageError(`未知参数: --${name}`)
    }
  }

  if (!['light', 'dark', 'both'].includes(options.mode)) {
    throw new UsageError(`--mode 只能是 light / dark / both，收到 ${options.mode}`)
  }
  if (!Number.isFinite(options.maxDiff) || options.maxDiff < 0) {
    throw new UsageError('--max-diff 必须是非负数字，例如 --max-diff=0.5')
  }
  if (!Number.isFinite(options.maxSolid) || options.maxSolid < 0) {
    throw new UsageError('--max-solid 必须是非负数字，例如 --max-solid=0.25')
  }
  if (!Number.isFinite(options.ignoreTop) || options.ignoreTop < 0) {
    throw new UsageError('--ignore-top 必须是非负 CSS px，例如 --ignore-top=0')
  }
  if (options.settle !== null && (!Number.isFinite(options.settle) || options.settle < 0)) {
    throw new UsageError('--settle 必须是非负毫秒数')
  }
  if (options.scenario !== null && !SCENARIO_IDS.includes(options.scenario)) {
    throw new UsageError(
      `--scenario 只能是 ${SCENARIO_IDS.join(' / ')}，收到 ${options.scenario}`
    )
  }
  if (options.mockupAsImpl && options.updateBaseline) {
    throw new UsageError('--mockup-as-impl 是渲染自检，不能再写 --update-baseline')
  }
  return options
}

const resolveOnly = (screens, tokens) => {
  if (tokens.length === 0) return screens
  const picked = []
  const unknown = []
  for (const token of tokens) {
    const byId = screens.find((screen) => screen.id === token)
    const byNumber = /^\d{1,2}$/.test(token)
      ? screens.find((screen) => screen.number === Number(token))
      : null
    const screen = byId ?? byNumber
    if (!screen) {
      unknown.push(token)
      continue
    }
    if (!picked.includes(screen)) picked.push(screen)
  }
  if (unknown.length > 0) {
    throw new UsageError(`未知屏: ${unknown.join(', ')}（id 见 src/mobile/screens/registry.ts）`)
  }
  return picked.sort((a, b) => a.number - b.number)
}

const exists = async (file) => {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/** 删除前把路径钉死在 tmp/shots 下，避免手滑清掉别的东西 */
const ensureInside = (target, parent) => {
  const resolved = path.resolve(target)
  const root = path.resolve(parent)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`拒绝操作不在 ${root} 下的路径: ${resolved}`)
  }
  return resolved
}

const relative = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/')

const percent = (value) => `${value.toFixed(2)}%`

const formatBBox = (bbox) =>
  bbox ? `x=${bbox.x} y=${bbox.y} ${bbox.width}×${bbox.height}` : '-'

const formatWorst = (worst, axis) =>
  worst.length === 0
    ? '-'
    : worst
        .slice(0, 3)
        .map((item) => `${axis}${item.index}:${item.pixels}px`)
        .join(' ')

/** 终端表格要按显示宽度补空格，否则中文屏名会把列推歪 */
const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u
const displayWidth = (text) =>
  [...text].reduce((width, char) => width + (WIDE_CHAR.test(char) ? 2 : 1), 0)

const padCell = (text, width) => `${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}`

const modesFor = (mode) => (mode === 'both' ? ['light', 'dark'] : [mode])

const buildReport = ({
  chromeVersion,
  chromePath,
  options,
  appDir,
  ignoreTopDevice,
  safeAreaOverride,
  safeAreaError,
  screens,
  allowances,
  results,
  summary,
}) => ({
  tool: 'scripts/shots.mjs',
  generatedAt: new Date().toISOString(),
  chrome: { version: chromeVersion, path: chromePath },
  viewport: { ...VIEWPORT, expectedImage: EXPECTED_IMAGE },
  thresholds: {
    maxDiffPercent: options.maxDiff,
    maxSolidPercent: options.maxSolid,
    ignoredTopPx: options.ignoreTop,
    ignoredTopDevicePx: ignoreTopDevice,
    pixelChannelTolerance: PIXEL_TOLERANCE,
    safeAreaTopPx: SAFE_AREA_INSETS.top,
    structuralRules: [
      '1px 邻域容差内找不到匹配颜色才算差异像素',
      '差异掩码 1px 腐蚀后仍有像素 = 成片差异（非抗锯齿）',
      '成片差异占参与像素比例 > maxSolidPercent 才失败',
      'diffPixels=0 时跳过内容包围盒判定',
      '两图内容包围盒（相对角部背景色）位置/宽高偏差 > 1px = 结构漂移',
      '顶部 ignoredTopPx 行不计入 totalPixels/diffPixels/bbox',
      '截图像素不是 780×1688 直接失败',
    ],
  },
  ignoredTopPx: options.ignoreTop,
  ignoredTopDevicePx: ignoreTopDevice,
  safeAreaOverride,
  safeAreaError,
  allowances,
  modes: modesFor(options.mode),
  scenario: options.scenario,
  mockupAsImpl: options.mockupAsImpl,
  appDir: relative(appDir),
  screens,
  summary,
  results,
})

const printSummary = ({
  results,
  summary,
  options,
  reportPath,
  chromeInfo,
  ignoreTopDevice,
  safeAreaOverride,
  allowances,
}) => {
  console.log('')
  console.log(
    `截图回归 · ${chromeInfo} · ${VIEWPORT.width}×${VIEWPORT.height} @${VIEWPORT.deviceScaleFactor}x ` +
      `→ ${EXPECTED_IMAGE.width}×${EXPECTED_IMAGE.height} · ` +
      `阈值 diff ${percent(options.maxDiff)} / solid ${percent(options.maxSolid)} · ` +
      `忽略顶部 ${options.ignoreTop}px(${ignoreTopDevice}px)`
  )
  if (safeAreaOverride === 'unsupported') {
    console.log('警告: Chrome 不支持 Emulation.setSafeAreaInsetsOverride，实现页安全区未模拟。')
  }
  if (allowances.length > 0) {
    console.log('豁免:')
    for (const allowance of allowances) {
      const parts = []
      if (allowance.maxDiffPercent !== undefined) {
        parts.push(`maxDiff=${percent(allowance.maxDiffPercent)}`)
      }
      if (allowance.maxSolidPercent !== undefined) {
        parts.push(`maxSolid=${percent(allowance.maxSolidPercent)}`)
      }
      if (allowance.ignoreBbox) parts.push('ignoreBbox')
      if (!allowance.applied) parts.push('未应用（屏未跑）')
      console.log(`  - ${allowance.id}: ${parts.join(' · ') || '无参数'} — ${allowance.reason}`)
    }
  }
  const screenWidth =
    Math.max(
      30,
      ...results.map((screen) =>
        displayWidth(`${String(screen.number).padStart(2, '0')} ${screen.id}`)
      )
    ) + 2
  const modeWidth = 16
  console.log(
    `${padCell('屏', screenWidth)}${padCell('明色 diff', modeWidth)}${padCell(
      '暗色 diff',
      modeWidth
    )}状态`
  )
  console.log('-'.repeat(screenWidth + modeWidth * 2 + 6))
  for (const screen of results) {
    const label = `${String(screen.number).padStart(2, '0')} ${screen.id}`
    const activeModes = modesFor(options.mode)
    // 固定两列：只跑一种模式时另一列必须是 '-'，不能把 dark 结果挪到明色列。
    const cells = ['light', 'dark'].map((mode) => {
      if (!activeModes.includes(mode)) return '-'
      const result = screen.modes?.[mode]
      if (!result) return '-'
      if (result.status === 'failed') {
        return result.diffPercent === undefined ? 'ERROR' : `${percent(result.diffPercent)} FAIL`
      }
      return percent(result.diffPercent ?? 0)
    })
    console.log(
      `${padCell(label, screenWidth)}${padCell(cells[0], modeWidth)}${padCell(
        cells[1],
        modeWidth
      )}${screen.status}`
    )
  }

  const failures = results.filter((screen) => screen.status === 'failed')
  if (failures.length > 0) {
    console.log('')
    console.log('失败:')
    for (const screen of failures) {
      if (screen.error) {
        console.log(`  - ${screen.id}: ${screen.error}`)
        continue
      }
      for (const mode of Object.keys(screen.modes ?? {})) {
        const result = screen.modes[mode]
        if (result.status !== 'failed') continue
        console.log(`  - ${screen.id} [${mode}] ${result.reasons.join('；')}`)
        if (result.diffPercent !== undefined) {
          console.log(
            `      diff ${percent(result.diffPercent)} · bbox ${formatBBox(
              result.bbox
            )} · 成片 ${result.solidPixels}px · 最差行 ${formatWorst(
              result.worstRows ?? [],
              'row '
            )} · 最差列 ${formatWorst(result.worstCols ?? [], 'col ')}`
          )
        }
        if (result.compareShot) console.log(`      对比图 ${result.compareShot}`)
      }
    }
  }

  const skipped = results.filter((screen) => screen.status === 'skipped')
  if (skipped.length > 0) {
    console.log('')
    const groups = new Map()
    for (const screen of skipped) {
      const reason = screen.reason ?? '未知原因'
      groups.set(reason, [...(groups.get(reason) ?? []), screen.id])
    }
    for (const [reason, ids] of groups) {
      console.log(`跳过 ${ids.length} 屏（${reason}）:`)
      let line = '  '
      for (const id of ids) {
        if (line.length + id.length + 2 > 100) {
          console.log(line)
          line = '  '
        }
        line += `${id}, `
      }
      if (line.trim()) console.log(line.replace(/, $/, ''))
    }
  }

  const warnings = []
  for (const screen of results) {
    for (const [mode, result] of Object.entries(screen.modes ?? {})) {
      if (result.status === 'skipped') continue
      if (result.stable === false) {
        warnings.push(`${screen.id} [${mode}] 截图未在 3 次内稳定`)
      }
      for (const error of result.pageErrors ?? []) {
        warnings.push(`${screen.id} [${mode}] 页面错误: ${error}`)
      }
    }
  }
  if (warnings.length > 0) {
    console.log('')
    console.log('警告:')
    for (const warning of warnings.slice(0, 20)) console.log(`  - ${warning}`)
    if (warnings.length > 20) console.log(`  … 其余 ${warnings.length - 20} 条见报告`)
  }

  console.log('')
  console.log(
    `总计 ${summary.total} 屏: ok ${summary.ok} / failed ${summary.failed} / ` +
      `skipped ${summary.skipped}`
  )
  if (summary.skipped > 0 && !options.mockupAsImpl) {
    console.log('提示: skipped 不计失败；CI 请确认 dist-mobile 是最新构建（pnpm build:mobile）。')
  }
  console.log(`报告: ${relative(reportPath)}`)
  console.log(`对比图: ${relative(PAIRS_DIR)}/`)
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return 0
  }

  const screens = await loadScreens(REPO_ROOT)
  const selected = resolveOnly(screens, options.only)
  const placeholderTexts = await loadPlaceholderTexts(REPO_ROOT)

  const appDir = options.appDir
    ? path.resolve(process.cwd(), options.appDir)
    : DEFAULT_APP_DIR
  const appIndex = path.join(appDir, 'index.html')
  const hasApp = options.mockupAsImpl ? true : await exists(appIndex)
  const missingAppReason = `实现产物缺失（${relative(appIndex)}）；先跑 pnpm build:mobile`
  const ignoreTopDevice = Math.round(options.ignoreTop * VIEWPORT.deviceScaleFactor)

  const chromeInfo = options.chrome
    ? { path: options.chrome, version: null }
    : detectChrome()
  if (!chromeInfo?.path) {
    throw new Error(
      '找不到 Chrome。用 --chrome=<path> 指定，或把 google-chrome / chromium 放进 PATH。'
    )
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  const pairsDir = ensureInside(PAIRS_DIR, OUTPUT_DIR)
  await fs.rm(pairsDir, { recursive: true, force: true })
  await fs.mkdir(pairsDir, { recursive: true })

  const profileDir = ensureInside(
    path.join(OUTPUT_DIR, `chrome-profile-${process.pid}-${Date.now()}`),
    OUTPUT_DIR
  )
  await fs.mkdir(profileDir, { recursive: true })

  let server = null
  let chrome = null
  let cdp = null
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    try {
      cdp?.close()
    } catch {
      // 连接可能已经断了
    }
    try {
      if (chrome) await chrome.stop()
    } catch {
      // 退出路径不掩盖原始错误
    }
    try {
      if (server) await server.close()
    } catch {
      // 同上
    }
    if (!options.keepChrome) {
      try {
        await fs.rm(profileDir, { recursive: true, force: true })
      } catch {
        // Chrome 偶尔还会写一下 profile，删不掉不影响结果
      }
    } else {
      console.log(`[chrome] 保留 profile: ${relative(profileDir)}`)
    }
  }
  process.once('SIGINT', () => {
    cleanup().finally(() => process.exit(130))
  })
  process.once('SIGTERM', () => {
    cleanup().finally(() => process.exit(143))
  })

  const pageErrors = []
  const drainPageErrors = () => pageErrors.splice(0).map((item) => item.slice(0, 600))

  // 安全区只在实现页开启；示意页用假状态栏，不能改它的几何。
  // 命令是实验性的：失败时记 unsupported 并照常跑，不偷偷换第二套视口。
  let safeAreaStatus = null
  let safeAreaError = null
  const applySafeArea = async (kind) => {
    if (options.mockupAsImpl || kind !== 'app') {
      if (safeAreaStatus === 'applied') {
        const cleared = await setSafeAreaInsets(cdp, ZERO_INSETS)
        if (!cleared.ok) {
          safeAreaStatus = 'unsupported'
          safeAreaError = cleared.error
        }
      }
      return 'not-needed'
    }
    if (safeAreaStatus === 'unsupported') return 'unsupported'
    const applied = await setSafeAreaInsets(cdp, SAFE_AREA_INSETS)
    if (applied.ok) {
      safeAreaStatus = 'applied'
      return 'applied'
    }
    safeAreaStatus = 'unsupported'
    safeAreaError = applied.error
    if (options.verbose) console.log(`[safe-area] 模拟失败: ${applied.error}`)
    return 'unsupported'
  }

  try {
    server = await startStaticServer({
      mockupDir: MOCKUP_DIR,
      appDir,
      shotsDir: OUTPUT_DIR,
    })

    const port = await findFreePort()
    chrome = await launchChrome({
      chromePath: chromeInfo.path,
      port,
      profileDir,
      verbose: options.verbose,
    })
    const chromeLabel = chrome.version ?? `${chromeInfo.path} (version 未知)`
    if (options.verbose) console.log(`[chrome] ${chromeLabel}`)

    cdp = await connectPage({ port, verbose: options.verbose })
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails
      pageErrors.push(details?.exception?.description ?? details?.text ?? '未知页面异常')
    })
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry?.level === 'error') {
        pageErrors.push(`[${params.entry.source}] ${params.entry.text}`)
      }
    })
    await setViewport(cdp, VIEWPORT)

    const settleFor = (kind) =>
      options.settle ?? (kind === 'mockup' ? MOCKUP_SETTLE_MS : APP_SETTLE_MS)

    const renderShot = async ({ url, kind, mode }) => {
      // 一次挂载失败先重试一次：36 屏连续导航时偶发 renderer 卡顿/资源正好在重建，
      // 重试能把偶发噪声挡在判定之外；连续失败仍照实报错并带页面错误。
      let lastError = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        drainPageErrors()
        try {
          const safeAreaOverride = await applySafeArea(kind)
          await preparePage(cdp, {
            url,
            scheme: mode,
            readyExpression:
              kind === 'mockup'
                ? "Boolean(document.querySelector('.phone'))"
                : "Boolean(document.getElementById('root')?.childElementCount)",
            verbose: options.verbose,
          })
          const shot = await captureStable(cdp, {
            firstDelayMs: settleFor(kind),
            gapMs: 350,
            attempts: 3,
          })
          return { ...shot, safeAreaOverride, pageErrors: drainPageErrors() }
        } catch (error) {
          lastError = error
          const errors = drainPageErrors()
          if (attempt === 2) {
            const suffix = errors.length > 0 ? `；页面错误: ${errors.join(' | ')}` : ''
            throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`)
          }
          if (options.verbose) {
            console.log(
              `[retry] ${kind} ${url} 第一次加载失败: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          }
          await sleep(300)
        }
      }
      throw lastError
    }

    const compareImages = async ({ mockupFile, implFile, mode }) => {
      const query = new URLSearchParams({
        a: `/__shots/pairs/${mockupFile}`,
        b: `/__shots/pairs/${implFile}`,
        tol: String(PIXEL_TOLERANCE),
        ignoreTop: String(ignoreTopDevice),
      })
      const url = `${server.origin}/__shots/compare?${query.toString()}`
      await preparePage(cdp, {
        url,
        scheme: mode,
        readyExpression: "typeof window.__run === 'function'",
        verbose: options.verbose,
      })
      const result = await evaluate(cdp, 'window.__run()', { awaitPromise: true })
      if (!result || typeof result !== 'object') {
        throw new Error('比对页没有返回结果')
      }
      return result
    }

    const results = []
    for (const screen of selected) {
      const mockupFile = `${screen.id}.html`
      const mockupPath = path.join(MOCKUP_DIR, 'screens', mockupFile)
      if (!(await exists(mockupPath))) {
        results.push({
          id: screen.id,
          number: screen.number,
          status: 'skipped',
          reason: '示意图缺失',
          modes: {},
        })
        continue
      }
      if (!hasApp) {
        results.push({
          id: screen.id,
          number: screen.number,
          status: 'skipped',
          reason: missingAppReason,
          modes: {},
        })
        continue
      }

      const scenario = scenarioFor(screen.id, options.scenario)
      const allowance = SCREEN_ALLOWANCES[screen.id] ?? null
      const mockupUrl = `${server.origin}/mockups/screens/${encodeURIComponent(mockupFile)}`
      const implUrl = options.mockupAsImpl
        ? mockupUrl
        : `${server.origin}/app/index.html?screen=${encodeURIComponent(
            screen.id
          )}&scenario=${encodeURIComponent(scenario)}`

      const result = {
        id: screen.id,
        number: screen.number,
        mockup: relative(mockupPath),
        implementation: options.mockupAsImpl
          ? 'mockup-as-impl'
          : implUrl.replace(server.origin, ''),
        scenario: options.mockupAsImpl ? null : scenario,
        status: 'ok',
        modes: {},
      }

      try {
        if (!options.mockupAsImpl) {
          // 先探一次实现页：占位页（屏还没注册）整屏记 skipped，不浪费两轮截图。
          // 连续导航偶发挂载超时同样重试一次，避免把 renderer 噪声当缺屏。
          let probeReady = false
          let probeError = null
          for (let attempt = 1; attempt <= 2; attempt++) {
            drainPageErrors()
            try {
              await preparePage(cdp, {
                url: implUrl,
                scheme: 'light',
                readyExpression: "Boolean(document.getElementById('root')?.childElementCount)",
                verbose: options.verbose,
              })
              probeReady = true
              break
            } catch (error) {
              probeError = error
              const errors = drainPageErrors()
              if (attempt === 2) {
                const suffix = errors.length > 0 ? `；页面错误: ${errors.join(' | ')}` : ''
                throw new Error(
                  `${error instanceof Error ? error.message : String(error)}${suffix}`
                )
              }
              if (options.verbose) {
                console.log(
                  `[retry] probe ${implUrl} 第一次加载失败: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                )
              }
              await sleep(300)
            }
          }
          if (!probeReady) throw probeError
          const state = await readPageState(cdp)
          drainPageErrors()
          if (placeholderTexts.some((text) => state.text.includes(text))) {
            results.push({
              ...result,
              status: 'skipped',
              reason: '实现页是占位（该屏未注册）',
            })
            continue
          }
        }

        for (const mode of modesFor(options.mode)) {
          const mockupFileOut = `${screen.id}-${mode}-mockup.png`
          const implFileOut = `${screen.id}-${mode}-impl.png`
          const mockupShotPath = path.join(pairsDir, mockupFileOut)
          const implShotPath = path.join(pairsDir, implFileOut)

          const mockupShot = await renderShot({ url: mockupUrl, kind: 'mockup', mode })
          const implShot = await renderShot({
            url: implUrl,
            kind: options.mockupAsImpl ? 'mockup' : 'app',
            mode,
          })
          await fs.writeFile(mockupShotPath, mockupShot.buffer)
          await fs.writeFile(implShotPath, implShot.buffer)

          const modeResult = {
            status: 'ok',
            mockupShot: relative(mockupShotPath),
            implShot: relative(implShotPath),
            compareShot: null,
            stable: mockupShot.stable && implShot.stable,
            attempts: Math.max(mockupShot.attempts, implShot.attempts),
            safeAreaOverride: implShot.safeAreaOverride,
            ignoredTopPx: options.ignoreTop,
            ignoredTopDevicePx: ignoreTopDevice,
            maxDiffPercent: allowance?.maxDiffPercent ?? options.maxDiff,
            maxSolidPercent: allowance?.maxSolidPercent ?? options.maxSolid,
            bboxIgnored: allowance?.ignoreBbox === true,
            pageErrors: [...mockupShot.pageErrors, ...implShot.pageErrors],
            reasons: [],
          }

          const sizeOk =
            mockupShot.size.width === EXPECTED_IMAGE.width &&
            mockupShot.size.height === EXPECTED_IMAGE.height &&
            implShot.size.width === EXPECTED_IMAGE.width &&
            implShot.size.height === EXPECTED_IMAGE.height
          modeResult.imageSize = {
            mockup: mockupShot.size,
            impl: implShot.size,
            expected: EXPECTED_IMAGE,
            ok: sizeOk,
          }
          if (!sizeOk) {
            modeResult.reasons.push(
              `截图尺寸不符（示意 ${mockupShot.size.width}×${mockupShot.size.height}、` +
                `实现 ${implShot.size.width}×${implShot.size.height}，` +
                `应为 ${EXPECTED_IMAGE.width}×${EXPECTED_IMAGE.height}）`
            )
          }

          try {
            const compared = await compareImages({
              mockupFile: mockupFileOut,
              implFile: implFileOut,
              mode,
            })
            if (compared.dimensionMismatch) {
              modeResult.reasons.push(
                `两图尺寸不同（${compared.widthA}×${compared.heightA} vs ` +
                  `${compared.widthB}×${compared.heightB}）`
              )
            } else {
              const compareFile = `${screen.id}-${mode}-compare.png`
              const comparePath = path.join(pairsDir, compareFile)
              await fs.writeFile(
                comparePath,
                Buffer.from(compared.compareImage.split(',')[1], 'base64')
              )
              modeResult.compareShot = relative(comparePath)
              modeResult.diffPercent = compared.diffPercent
              modeResult.diffPixels = compared.diffPixels
              modeResult.totalPixels = compared.totalPixels
              modeResult.ignoredTopDevicePx = compared.ignoredTopDevicePx
              modeResult.maxChannelDiff = compared.maxChannelDiff
              modeResult.bbox = compared.bbox
              modeResult.solidPixels = compared.solidPixels
              modeResult.solidBBox = compared.solidBBox
              modeResult.structural = compared.structural
              modeResult.worstRows = compared.worstRows
              modeResult.worstCols = compared.worstCols
              const solidRatio =
                compared.totalPixels > 0
                  ? (compared.solidPixels / compared.totalPixels) * 100
                  : 0
              modeResult.solidPercent = Math.round(solidRatio * 10000) / 10000
              if (modeResult.diffPercent > modeResult.maxDiffPercent) {
                modeResult.reasons.push(
                  `diff ${percent(modeResult.diffPercent)} > 阈值 ${percent(
                    modeResult.maxDiffPercent
                  )}`
                )
              }
              if (solidRatio > modeResult.maxSolidPercent) {
                modeResult.reasons.push(
                  `成片差异 ${percent(modeResult.solidPercent)} > 阈值 ${percent(
                    modeResult.maxSolidPercent
                  )}（${compared.solidPixels}px / ${compared.totalPixels}px）`
                )
              }
              if (compared.structural.layoutShift && !modeResult.bboxIgnored) {
                modeResult.reasons.push(
                  `内容包围盒偏移 >1px（示意 ${formatBBox(
                    compared.structural.contentBboxA
                  )} vs 实现 ${formatBBox(compared.structural.contentBboxB)}）`
                )
              }
            }
          } catch (error) {
            modeResult.reasons.push(
              `比对失败: ${error instanceof Error ? error.message : String(error)}`
            )
          }

          if (modeResult.reasons.length > 0) {
            modeResult.status = 'failed'
            result.status = 'failed'
          }

          if (options.updateBaseline && !options.mockupAsImpl) {
            const baselinePath =
              mode === 'dark'
                ? path.join(BASELINE_DIR, 'dark', `${screen.id}.png`)
                : path.join(BASELINE_DIR, `${screen.id}.png`)
            await fs.mkdir(path.dirname(baselinePath), { recursive: true })
            await fs.writeFile(baselinePath, implShot.buffer)
            modeResult.baselineShot = relative(baselinePath)
          }

          result.modes[mode] = modeResult
          if (options.verbose) {
            console.log(
              `[shot] ${screen.id} ${mode}: ` +
                (modeResult.diffPercent === undefined
                  ? modeResult.status
                  : `${percent(modeResult.diffPercent)} ${modeResult.status}`)
            )
          }
        }
      } catch (error) {
        result.status = 'failed'
        result.error = error instanceof Error ? error.message : String(error)
        result.modes = {}
      }
      results.push(result)
    }

    const summary = {
      total: results.length,
      ok: results.filter((item) => item.status === 'ok').length,
      failed: results.filter((item) => item.status === 'failed').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
    }

    const allowances = selected
      .filter((screen) => SCREEN_ALLOWANCES[screen.id])
      .map((screen) => {
        const entry = SCREEN_ALLOWANCES[screen.id]
        const result = results.find((item) => item.id === screen.id)
        return {
          id: screen.id,
          ...entry,
          applied: Boolean(result && result.status !== 'skipped'),
        }
      })

    const report = buildReport({
      chromeVersion: chrome.version,
      chromePath: chromeInfo.path,
      options,
      appDir,
      ignoreTopDevice,
      safeAreaOverride: safeAreaStatus ?? 'not-needed',
      safeAreaError,
      screens: selected.map((screen) => ({ id: screen.id, number: screen.number })),
      allowances,
      results,
      summary,
    })
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    printSummary({
      results,
      summary,
      options,
      reportPath: REPORT_PATH,
      chromeInfo: chromeLabel,
      ignoreTopDevice,
      safeAreaOverride: safeAreaStatus ?? 'not-needed',
      allowances,
    })

    return summary.failed > 0 ? 1 : 0
  } finally {
    await cleanup()
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    if (error instanceof UsageError) {
      console.error(`错误: ${error.message}`)
      console.error('')
      console.error(HELP)
      process.exitCode = 2
      return
    }
    console.error(`失败: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  })
