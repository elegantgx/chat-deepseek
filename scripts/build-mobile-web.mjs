import { spawnSync } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 构建 Android mobile Web（`dist-mobile/`）。
 *
 * 与 `build-web.mjs` 一样用 Node 包住跨平台差异：
 * Windows 的 pnpm 脚本走 cmd.exe，`rm -rf` 和行内 `NODE_ENV=...` 都不可用。
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const output = path.join(root, 'dist-mobile')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
    shell: process.platform === 'win32',
  })
  if (result.error) {
    console.error(`[build:mobile] 启动 ${command} 失败：${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const rspack = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'rspack.cmd' : 'rspack'
)

await rm(output, { recursive: true, force: true })
run(rspack, ['build', '-c', 'rspack.mobile.config.ts'])

try {
  await access(path.join(output, 'index.html'))
} catch {
  console.error('[build:mobile] 构建结束但没有 dist-mobile/index.html')
  process.exit(1)
}
console.log('[build:mobile] 已输出 dist-mobile/index.html')
