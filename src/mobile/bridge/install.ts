import { callBridge } from './callbacks.js'
import { encodeBytes } from './codec.js'
import { bridgeFetch, setFallbackFetch } from './fetch.js'
import { FILE_SAVED_EVENT, saveBlobToShell } from './save-file.js'
import type { SaveBlobResult } from './save-file.js'
import type { ChatShell } from './types.js'

let installed = false

/**
 * 只在 `src/mobile/main.tsx` 调用一次：桌面构建与浏览器构建不 import 这个模块，
 * 所以 `src/services/api/client.ts` 的写法完全不用变。
 *
 * 安装顺序：**先抓住原生 fetch 再替换**。`<a download>` 拦下来后要读 `blob:` URL，
 * 那一步不能走桥（桥只接管 `/api/`），必须用替换前的原生 fetch。
 */
export const installBridge = (): void => {
  if (installed) {
    return
  }
  installed = true
  const original = globalThis.fetch.bind(globalThis)
  setFallbackFetch(original)
  installDownloadInterceptor(original)
  // tsconfig 同时带 DOM 与 @types/node，两边的 fetch/Request 类型并不完全同构；
  // 运行时就是浏览器那个 fetch，这里按 DOM 的签名实现后转交。
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    bridgeFetch(input, init)) as unknown as typeof fetch
}

/** 壳能力只查一次；ready() 是同步的，正常也已经缓存过。 */
let saveFileSupported: boolean | undefined

const supportsSaveFile = (shell: ChatShell): boolean => {
  if (saveFileSupported !== undefined) {
    return saveFileSupported
  }
  try {
    const parsed = JSON.parse(shell.ready()) as { capabilities?: { platform?: unknown } }
    const platform = parsed.capabilities?.platform
    saveFileSupported = Array.isArray(platform) && platform.includes('saveFile')
  } catch {
    // ready() 不合法时按「没有这个能力」处理，让浏览器原生下载继续，不要吞掉点击。
    saveFileSupported = false
  }
  return saveFileSupported
}

const dispatchSaved = (ok: boolean, reason?: string): void => {
  const detail: SaveBlobResult = reason === undefined ? { ok } : { ok, reason }
  window.dispatchEvent(new CustomEvent(FILE_SAVED_EVENT, { detail }))
}

let saveSequence = 0

const nextSaveTempId = (): string => {
  saveSequence += 1
  return `blob-${Date.now().toString(36)}-${saveSequence}`
}

/**
 * 包一层 `HTMLAnchorElement.prototype.click`。
 *
 * 触发条件必须同时满足：带 `download` 属性、href 是 `blob:`、壳声明了 `saveFile`。
 * 其它情况（普通链接、data: 链接、浏览器预览里的 fake 壳）一律交给原生 click，
 * 保证截图预览与桌面浏览器行为不变。
 */
const installDownloadInterceptor = (nativeFetch: typeof fetch): void => {
  const originalClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    const shell = window.ChatShell
    if (
      !shell ||
      !this.hasAttribute('download') ||
      !this.href.startsWith('blob:') ||
      !supportsSaveFile(shell)
    ) {
      originalClick.call(this)
      return
    }

    const name = this.getAttribute('download')?.trim() || 'download.bin'
    const tempId = nextSaveTempId()
    const url = this.href
    void saveBlobToShell({
      tempId,
      name,
      url,
      fetchBlob: async (blobUrl) => {
        const response = await nativeFetch(blobUrl)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return response.blob()
      },
      encodeBase64: encodeBytes,
      fileBegin: (id, metaJson) => shell.fileBegin(id, metaJson),
      fileChunk: (id, base64) => shell.fileChunk(id, base64),
      fileEnd: (id) => shell.fileEnd(id),
      abort: (id) => shell.abort(id),
      saveFile: async (params) => {
        await callBridge<unknown>(
          (id) => shell.platform(id, 'saveFile', JSON.stringify(params)),
          { abort: (id) => shell.abort(id) }
        )
      },
    }).then((result) => {
      dispatchSaved(result.ok, result.reason)
    })
  }
}
