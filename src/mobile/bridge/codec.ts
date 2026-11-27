/**
 * 桥的 base64 编解码。
 *
 * 为什么要手写：桥只能传字符串，附件分块与 SSE 字节都要走 base64；
 * `btoa`/`atob` 只接受 Latin-1 字符串，大块直接 `String.fromCharCode(...bytes)`
 * 会爆栈，所以按 32 KiB 分段拼接。
 */

const STRING_CHUNK = 0x8000

export const encodeBytes = (bytes: Uint8Array): string => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += STRING_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + STRING_CHUNK))
  }
  return btoa(binary)
}

export const decodeBytes = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const encodeText = (text: string): Uint8Array => encoder.encode(text)

/** 文本 → base64，给 netRequest 的 JSON 响应体用 */
export const encodeTextBase64 = (text: string): string => encodeBytes(encoder.encode(text))

/** base64 → 文本；解析 SSE / JSON 用 */
export const decodeTextBase64 = (value: string): string => decoder.decode(decodeBytes(value))
