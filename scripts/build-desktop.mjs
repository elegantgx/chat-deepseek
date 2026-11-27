import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `desktop:build` 原来是 `NODE_ENV=production ./node_modules/.bin/...`，
// 在 Windows 的 cmd.exe 里跑不了。桌面端也要在 Windows runner 上出 NSIS，所以统一走这里。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function bin(name) {
  return path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name
  )
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
    shell: process.platform === 'win32',
  })
  if (result.error) {
    console.error(`[desktop] 启动 ${command} 失败：${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run(bin('tsc'), ['-p', 'desktop/tsconfig.main.json'])
run(bin('rspack'), ['build', '-c', 'desktop/rspack.config.ts'])
