import { decodeBytes, encodeText } from '../bridge/codec.js'
import type { ChatShell, ShellLocale } from '../bridge/types.js'
import { createReady, parseScenarioId } from './fixtures.js'
import { dispatchHost } from './host.js'
import {
  dispatchNetRequest,
  dispatchNetStream,
  dispatchNetUpload,
  normalizeUploadMeta,
} from './net.js'
import {
  createRuntime,
  createState,
  type ScenarioRuntime,
  type ScenarioState,
  type TempFile,
} from './state.js'

/**
 * 浏览器预览 / 截图回归用的 `ChatShell` 替身。
 *
 * 它和 Kotlin 壳实现同一份接口，所以 `main.tsx` 不区分真假；
 * 场景只影响 ready() 与 host/net 的固定数据，渲染层代码一行都不用改。
 */

const PLATFORM_LATENCY_MS = 60

const dispatchPlatform = (
  runtime: ScenarioRuntime,
  id: string,
  method: string,
  paramsJson: string
): void => {
  // fake 的平台能力不区分参数（真壳才校验），显式消费一下以示“有意忽略”。
  void paramsJson
  runtime.after(id, PLATFORM_LATENCY_MS, () => {
    switch (method) {
      case 'pickFiles': {
        const bytes = encodeText('这是 fake 场景里的附件内容。')
        runtime.state.tempFiles.set('picked-1', {
          meta: { name: 'scenario-note.txt', mime: 'text/plain', size: bytes.length },
          chunks: [bytes],
          closed: true,
        })
        runtime.done(id, {
          files: [
            {
              name: 'scenario-note.txt',
              mime: 'text/plain',
              size: bytes.length,
              tempId: 'picked-1',
            },
          ],
        })
        return
      }
      case 'share':
      case 'openExternal':
      case 'notify':
      case 'setKeepScreenOn':
        runtime.done(id, { ok: true })
        return
      case 'requestPermission':
        runtime.done(id, { granted: true })
        return
      default:
        runtime.fail(id, { code: 'unsupported', message: `场景不支持平台能力 "${method}"` })
    }
  })
}

const readTemp = (state: ScenarioState, tempId: string, metaJson = '{}'): TempFile => {
  const existing = state.tempFiles.get(tempId)
  if (existing) {
    return existing
  }
  const temp: TempFile = { meta: normalizeUploadMeta(metaJson), chunks: [], closed: false }
  state.tempFiles.set(tempId, temp)
  return temp
}

export const createScenarioShell = (
  scenarioValue: string | null | undefined,
  localeValue?: string | null
): ChatShell => {
  const scenario = parseScenarioId(scenarioValue)
  const locale: ShellLocale = localeValue === 'en-US' ? 'en-US' : 'zh-CN'
  const state = createState(scenario, locale)
  const runtime = createRuntime(state)

  return {
    ready: () => JSON.stringify(createReady(scenario, state.locale)),
    host: (id, method, paramsJson) => dispatchHost(runtime, id, method, paramsJson),
    netRequest: (id, specJson) => dispatchNetRequest(runtime, id, specJson),
    netStream: (id, specJson) => dispatchNetStream(runtime, id, specJson),
    netUpload: (id, specJson) => dispatchNetUpload(runtime, id, specJson),
    platform: (id, method, paramsJson) => dispatchPlatform(runtime, id, method, paramsJson),
    abort: (id) => {
      runtime.cancel(id)
      // 取消上传时 id 可能是临时文件 id（fetch.ts 的兜底清理），一起删掉。
      state.tempFiles.delete(id)
    },
    fileBegin: (id, metaJson) => {
      state.tempFiles.set(id, {
        meta: normalizeUploadMeta(metaJson),
        chunks: [],
        closed: false,
      })
    },
    fileChunk: (tempId, base64) => {
      const temp = readTemp(state, tempId)
      try {
        temp.chunks.push(decodeBytes(base64))
      } catch {
        // 同步接口没有错误回调；坏块丢掉，保持 fake 不崩。
        return
      }
    },
    fileEnd: (tempId) => {
      readTemp(state, tempId).closed = true
    },
  }
}
