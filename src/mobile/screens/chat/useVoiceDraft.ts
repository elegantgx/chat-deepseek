import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '../../../i18n/index.js'
import { transcribe } from '../../../services/api/speech.js'
import { startRecording, type Recording } from '../../../services/speech/recorder.js'

export type VoiceStatus = 'idle' | 'recording' | 'transcribing'

/** 录音依赖 getUserMedia，只在安全上下文（HTTPS/localhost/WebView 白名单）可用 */
const AVAILABLE = typeof window === 'undefined' || window.isSecureContext

/**
 * 聊天输入区的语音（oneshot）：点一下开始、再点一下结束并转写。
 *
 * 与主站 `useVoiceInput` 的差别只在提示通道：mobile 的 toast 由 Shell 的
 * `ToastProvider` 提供，不能用主站的 `showToast`；录音与转写仍复用同一套 services。
 * 录音、转写都可以被再次点击取消，组件卸载时释放麦克风。
 */
export const useVoiceDraft = (
  appendText: (text: string) => void,
  showToast: (message: string) => void,
  notices: { recording: string; transcribing: string }
) => {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const recordingRef = useRef<Recording | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const operationRef = useRef(0)
  const appendRef = useRef(appendText)
  appendRef.current = appendText
  const noticesRef = useRef(notices)
  noticesRef.current = notices

  const cancel = useCallback(() => {
    operationRef.current += 1
    recordingRef.current?.cancel()
    recordingRef.current = null
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus('idle')
  }, [])

  const finish = useCallback(async () => {
    const recording = recordingRef.current
    if (!recording) {
      cancel()
      return
    }
    const operation = operationRef.current
    recordingRef.current = null
    try {
      let audio: Blob | null
      try {
        audio = await recording.stop()
      } finally {
        recording.cancel()
      }
      if (operationRef.current !== operation || !audio) {
        return
      }
      const controller = new AbortController()
      controllerRef.current = controller
      setStatus('transcribing')
      showToast(noticesRef.current.transcribing)
      const text = await transcribe(audio, controller.signal)
      if (controller.signal.aborted || operationRef.current !== operation) {
        return
      }
      const trimmed = text.trim()
      if (trimmed) {
        appendRef.current(trimmed)
      } else {
        showToast(translate('voiceInputEmpty'))
      }
    } catch {
      if (operationRef.current === operation && !controllerRef.current?.signal.aborted) {
        showToast(translate('voiceInputFailed'))
      }
    } finally {
      if (operationRef.current === operation) {
        controllerRef.current = null
        setStatus('idle')
      }
    }
  }, [cancel, showToast])

  const toggle = useCallback(async () => {
    if (!AVAILABLE) {
      showToast(translate('voiceInputRequiresHttps'))
      return
    }
    if (status === 'recording') {
      await finish()
      return
    }
    if (status === 'transcribing') {
      cancel()
      return
    }
    const operation = ++operationRef.current
    setStatus('recording')
    showToast(noticesRef.current.recording)
    try {
      const recording = await startRecording(() => {
        if (operationRef.current === operation) {
          showToast(translate('voiceInputLimitReached'))
          void finish()
        }
      })
      if (operationRef.current !== operation) {
        recording.cancel()
        return
      }
      recordingRef.current = recording
    } catch (error) {
      if (operationRef.current === operation) {
        setStatus('idle')
        const denied =
          error instanceof DOMException &&
          (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        showToast(translate(denied ? 'voiceInputPermissionDenied' : 'voiceInputFailed'))
      }
    }
  }, [cancel, finish, showToast, status])

  useEffect(() => cancel, [cancel])

  return { status, toggle, available: AVAILABLE }
}
