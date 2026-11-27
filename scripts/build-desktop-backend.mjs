import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 构建随桌面端分发的 Go 二进制。
 *
 * 输出固定在 desktop/build/backend/bin：electron-builder.yml 的 extraResources
 * 从这里取，打包后落到 <安装目录>/resources/bin/chat-deepseek[.exe]。
 * 服务端发布包复用同一份产物（workflow 里复制到 tmp/release/server）。
 */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const osByPlatform = { linux: 'linux', darwin: 'darwin', win32: 'windows' }
const archByPlatform = { x64: 'amd64', arm64: 'arm64', ia32: '386' }
const goos = process.env.GOOS || osByPlatform[process.platform]
const goarch = process.env.GOARCH || archByPlatform[process.arch]
if (!goos || !goarch) {
  console.error(`[desktop] 无法推断 GOOS/GOARCH：${process.platform}/${process.arch}`)
  process.exit(2)
}

// tag 发布时 workflow 注入 VERSION（含 v 前缀）；本地构建回落到 package.json 版本。
const version = process.env.VERSION || pkg.version
const outputDir = path.join(root, 'desktop', 'build', 'backend', 'bin')
const output = path.join(outputDir, `chat-deepseek${goos === 'windows' ? '.exe' : ''}`)
mkdirSync(outputDir, { recursive: true })

const result = spawnSync(
  'go',
  [
    'build',
    '-trimpath',
    '-ldflags',
    `-s -w -X github.com/elegantgx/chat-deepseek/internal/buildinfo.Version=${version}`,
    '-o',
    output,
    './cmd/chat-deepseek',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    // 服务端二进制仍保持纯静态：不启用 CGO，避免绑定构建机 glibc
    env: { ...process.env, CGO_ENABLED: '0', GOOS: goos, GOARCH: goarch },
  }
)
if (result.error) {
  console.error(`[desktop] 启动 go 失败：${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log(
  `[desktop] 后端二进制 ${path.relative(root, output)}（GOOS=${goos} GOARCH=${goarch} version=${version}）`
)
