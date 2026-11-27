/**
 * 把 `blob:` 下载交给壳保存的纯逻辑。
 *
 * 为什么单独成文件：这段流程（读 Blob → 分片过桥 → 调平台 saveFile → 失败清理）与 DOM、
 * WebView 都无关，可以拿 fake shell 在 Node 里逐字节验证；`install.ts` 只负责拦截 `<a download>`。
 */

/** 壳保存完成/失败时派发到 window 的事件；UI 层监听后 toast。 */
export const FILE_SAVED_EVENT = 'chatbridge:file-saved'

/** 与 §4.1 的 `fileChunk` 上限对齐：一条原文 ≤256 KiB。 */
export const SAVE_FILE_CHUNK_BYTES = 256 * 1024

export interface SaveBlobResult {
  ok: boolean
  /** 失败原因，只用于诊断；用户文案由监听方按 i18n 决定 */
  reason?: string
}

export interface SaveBlobToShellOptions {
  /** 渲染层生成的临时文件 id，同时是 fileBegin 的 id/tempId */
  tempId: string
  name: string
  url: string
  fetchBlob: (url: string) => Promise<Blob>
  encodeBase64: (bytes: Uint8Array) => string
  fileBegin: (tempId: string, metaJson: string) => void
  fileChunk: (tempId: string, base64: string) => void
  fileEnd: (tempId: string) => void
  abort: (tempId: string) => void
  saveFile: (params: { name: string; mime: string; tempId: string }) => Promise<void>
}

/**
 * 读 `blob:` → 分片写进壳 → 让用户选保存位置。
 *
 * 成功时壳在 `saveFile` 内部删临时文件；任何失败（含用户取消保存）都调 `abort(tempId)`，
 * 保证不会因为反复取消把缓存撑满。返回结果而不抛异常，调用方统一派发事件。
 */
const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  // callBridge 失败时 reject 的是 `{code, message}` 纯对象，String() 会变成 [object Object]。
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    return typeof code === 'string' ? code : 'unknown'
  }
  return String(error)
}

export const saveBlobToShell = async (
  options: SaveBlobToShellOptions
): Promise<SaveBlobResult> => {
  const { tempId } = options
  try {
    const blob = await options.fetchBlob(options.url)
    const mime = blob.type.length > 0 ? blob.type : 'application/octet-stream'
    const bytes = new Uint8Array(await blob.arrayBuffer())
    options.fileBegin(tempId, JSON.stringify({ name: options.name, mime, size: bytes.byteLength }))
    for (let offset = 0; offset < bytes.length; offset += SAVE_FILE_CHUNK_BYTES) {
      options.fileChunk(
        tempId,
        options.encodeBase64(bytes.subarray(offset, offset + SAVE_FILE_CHUNK_BYTES))
      )
    }
    options.fileEnd(tempId)
    await options.saveFile({ name: options.name, mime, tempId })
    return { ok: true }
  } catch (error) {
    try {
      options.abort(tempId)
    } catch {
      // 清理失败不能盖住原始错误；壳对未知 id 也会忽略。
    }
    return { ok: false, reason: describeError(error) }
  }
}
