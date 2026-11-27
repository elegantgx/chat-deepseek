import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 屏清单的唯一来源是 `src/mobile/screens/registry.ts`。
 *
 * 脚本不 import TS（Node 直接跑不了），所以只解析 `SCREENS` 数组里
 * `{ id: '…', number: N }` 这两项。registry 故意把 id/编号钉死，解析它比在脚本里
 * 再抄一份 36 行更不容易漂；解析不到就报错，不静默跑空。
 */

export const SCENARIO_IDS = [
  'local-installed',
  'local-uninitialized',
  'local-stopped',
  'remote-connected',
  'chat-history',
  'chat-empty',
  'chat-drawer',
]

export const DEFAULT_SCENARIO = 'local-installed'

/**
 * 每屏截图时喂给 `?scenario=` 的起点状态。
 *
 * 场景只负责 fake host/net 的固定数据，不是屏的“正确答案”：没有专门 fixture 的
 * 中间态（比如安装失败、远程离线）只能用最接近的场景，差异由报告暴露出来。
 * 需要全量换场景时用 `--scenario=` 覆盖。
 */
const SCENARIO_BY_SCREEN = {
  launch: 'local-uninitialized',
  'server-uninit': 'local-uninitialized',
  'server-preparing': 'local-uninitialized',
  'server-failed': 'local-uninitialized',
  'account-create': 'local-uninitialized',
  'account-create-error': 'local-uninitialized',
  'server-stopped': 'local-stopped',
  'server-local': 'local-installed',
  'server-remote-add': 'local-installed',
  'server-remote-add-failed': 'local-installed',
  'server-remote-login': 'remote-connected',
  'server-remote-login-error': 'remote-connected',
  'server-remote-detail': 'remote-connected',
  'server-remote-detail-offline': 'remote-connected',
  'chat-drawer': 'chat-drawer',
}

export const scenarioFor = (id, override) => override ?? SCENARIO_BY_SCREEN[id] ?? DEFAULT_SCENARIO

/**
 * 逐屏判定豁免。只放“已经确认是设计/数据噪声、不是结构回归”的屏；
 * 每项必须写 reason，report 和终端摘要都会原样带出来，避免豁免变成黑盒。
 *
 * - ignoreBbox：跳过内容包围盒判定（diff/solid 仍然照常看）；
 * - maxDiffPercent / maxSolidPercent：该屏的 diff / solid 阈值覆盖全局参数。
 */
export const SCREEN_ALLOWANCES = {
  'chat-drawer': {
    ignoreBbox: true,
    reason:
      '抽屉背后是真实会话（滚动位置/数据随 fixture），只保证抽屉本身；整屏 bbox 不参与判定',
  },
  'server-preparing': {
    maxDiffPercent: 5,
    maxSolidPercent: 5,
    reason:
      '示意把禁用主按钮画成灰底，与 visual §5「禁用主按钮保留品牌色 45%，不要灰底」冲突；实现按规范。示意灰底与规范冲突，整块按钮颜色不同，diff 与 solid 都单独豁免',
  },
}

export const loadScreens = async (repoRoot) => {
  const registryPath = path.join(repoRoot, 'src/mobile/screens/registry.ts')
  const source = await fs.readFile(registryPath, 'utf8')
  const block = source.match(/export const SCREENS = \[([\s\S]*?)\]\s*as const/)?.[1]
  if (!block) {
    throw new Error(`无法从 ${registryPath} 解析 SCREENS 数组`)
  }
  const screens = []
  const pattern = /\{\s*id:\s*'([^']+)',\s*number:\s*(\d+)/g
  let match
  while ((match = pattern.exec(block))) {
    screens.push({ id: match[1], number: Number(match[2]) })
  }
  if (screens.length === 0) {
    throw new Error('registry.ts 的 SCREENS 解析结果为空')
  }
  const seenIds = new Set()
  const seenNumbers = new Set()
  for (const screen of screens) {
    if (seenIds.has(screen.id) || seenNumbers.has(screen.number)) {
      throw new Error(`registry.ts 有重复的屏 id 或编号: ${screen.id} / ${screen.number}`)
    }
    seenIds.add(screen.id)
    seenNumbers.add(screen.number)
  }
  return screens.sort((a, b) => a.number - b.number)
}

/**
 * 占位页文案从 i18n 里取，避免脚本硬编码中文/英文后与 `mobileNotImplemented` 漂移。
 * 取不到时退回当前文案，只用于“实现未注册 → skipped”的判定。
 */
export const loadPlaceholderTexts = async (repoRoot) => {
  const fallback = ['这一屏还没实现', 'This screen is not implemented yet']
  const read = async (locale) => {
    try {
      const source = await fs.readFile(path.join(repoRoot, `src/i18n/${locale}.ts`), 'utf8')
      return source.match(/mobileNotImplemented:\s*'([^']+)'/)?.[1] ?? null
    } catch {
      return null
    }
  }
  const texts = (await Promise.all([read('zh'), read('en')])).filter(Boolean)
  return texts.length > 0 ? [...new Set([...texts, ...fallback])] : fallback
}
