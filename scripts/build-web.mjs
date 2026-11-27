import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Windows 的 npm/pnpm 脚本走 cmd.exe：`rm -rf` 和行内 `NODE_ENV=...` 都不可用。
// 三个平台的流水线要跑同一条 `pnpm build`，所以把这两步收进 Node 脚本。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
    // Windows 的 .cmd 需要通过 shell 启动
    shell: process.platform === 'win32',
  })
  if (result.error) {
    console.error(`[build] 启动 ${command} 失败：${result.error.message}`)
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

await rm(path.join(root, 'dist'), { recursive: true, force: true })
run(rspack, ['build', '-c', 'rspack.config.ts'])
run(process.execPath, [path.join(root, 'scripts', 'embed-ui.mjs')])
