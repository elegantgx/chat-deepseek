import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useRoute } from '../../app/navigation.js'
import { useIsMock, useHost } from '../../app/runtime.js'
import { useToast } from '../../app/toast.js'
import { getMe } from '../../../services/api/server.js'
import { formatSize, useUploads, ACCEPT } from '../../../services/attachments.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../../services/chat/branches.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../../services/chat/drafts.js'
import {
  bindChatPersistence,
  continueReply,
  initChat,
  newChat,
  regenerateReply,
  removeSession,
  retrySaveSessions,
  retryUpload,
  selectMessageVersion,
  selectSession,
  sendMessage,
  stopReply,
  useChatStore,
} from '../../../services/chat/store.js'
import type { AssistantMessage } from '../../../services/chat/types.js'
import { loadSettings, setSearch, setThinking, useSettings } from '../../../services/settings.js'
import { copyText } from '../../../utils/clipboard.js'
import { openExternal } from '../../bridge/platform.js'
import { translate, useTranslate } from '../../../i18n/index.js'
import {
  AttachmentRow,
  Button,
  ChatTopBar,
  Composer,
  FileIcon,
  GlobeFilledIcon,
  IconButton,
  MenuIcon,
  MuteIcon,
  NewChatIcon,
  Notice,
  Spinner,
  ThinkIcon,
  ToggleChip,
  WhaleIcon,
} from '../../ui/index.js'
import { useStrings } from '../strings.js'
import { DrawerPanel } from './DrawerPanel.js'
import { MessageList } from './MessageList.js'
import { chatStrings } from './strings.js'
import { useKeyboardInset } from './useKeyboardInset.js'
import { useVoiceDraft } from './useVoiceDraft.js'
import styles from './ChatScreen.module.css'

/**
 * 聊天主界面：欢迎空态与会话态是同一个屏的两个分支。
 *
 * - 路由里的 `chat-welcome` / `chat-drawer` 指向同一个组件，`drawerOpen` 由当前屏 id 推导；
 *   这样打开/关闭抽屉只改 hash，聊天内容（滚动、输入焦点、生成中的消息）不会被卸载；
 * - 数据全部来自 `services/chat` 的 store：可视消息按 `parentId`/`selectedChildId` 取路径，
 *   草稿、发送、停止、重试、版本切换都调用 store 的动作，屏里不复制业务状态；
 * - 抽屉打开时聊天页整体右移并缩成圆角卡（示意 chat-drawer），不另盖黑色遮罩。
 */
export const ChatScreen = () => {
  const route = useRoute()
  const navigate = useNavigate()
  const t = useTranslate()
  const strings = useStrings(chatStrings)
  const { showToast } = useToast()
  const host = useHost()
  const isMock = useIsMock()
  const rootRef = useKeyboardInset()

  const drawerOpen = route.screen === 'chat-drawer'
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const session = useChatStore((state) =>
    state.activeId !== null ? state.sessionCache[state.activeId] : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId !== null ? state.sessionLoadErrors[state.activeId] === true : false
  )
  const streaming = useChatStore((state) =>
    state.activeId !== null ? Object.hasOwn(state.streaming, state.activeId) : false
  )
  const saveError = useChatStore((state) =>
    state.activeId !== null ? state.sessionSaveErrors[state.activeId] === true : false
  )
  const thinking = useSettings((state) => state.thinking)
  const search = useSettings((state) => state.search)
  const drafts = useDrafts((state) => state.drafts)
  const uploadTasks = useUploads((state) => state.tasks)
  const draft = drafts.get(activeId) ?? EMPTY_DRAFT

  const [account, setAccount] = useState('')
  const [muted, setMuted] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const autoSelectedRef = useRef(false)
  const versionsRef = useRef<ReadonlyMap<string, MessageVersions>>(new Map())

  const messages = useMemo(() => (session ? getVisibleMessages(session) : []), [session])
  const versions = useMemo(() => {
    if (!session) {
      return versionsRef.current
    }
    const next = buildMessageVersions(session, versionsRef.current)
    versionsRef.current = next
    return next
  }, [session])

  const hasMessages = messages.length > 0
  const loadingSession = activeId !== null && !session && !sessionLoadError
  const title = hasMessages && session ? session.title || t('untitledChat') : ''

  useEffect(() => {
    void initChat()
    // 设置读失败（未登录/远程会话建立中）不阻断聊天；输入区仍可用默认开关。
    void loadSettings().catch(() => {})
  }, [])

  useEffect(bindChatPersistence, [])

  // 打开抽屉时输入框还聚焦着的话，软键盘会继续占着半屏；先失焦再让布局回到全高。
  useEffect(() => {
    if (drawerOpen && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [drawerOpen])

  // 账户名走 HTTP 会话；远程服务器上也能拿到，不依赖本机 ipc。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const me = await getMe()
        if (!cancelled && me) {
          setAccount(me.user.username)
          return
        }
      } catch {
        // 掉到 ipc 兜底；两者都失败时抽屉只显示占位符。
      }
      try {
        const who = (await host.request('auth.whoami')) as { username?: string }
        if (!cancelled && typeof who?.username === 'string') {
          setAccount(who.username)
        }
      } catch {
        // 没有登录态时不编造用户名。
      }
    })()
    return () => {
      cancelled = true
    }
  }, [host])

  /**
   * 直接打开 chat-drawer（截图、深链）时把最近一条会话选中，让抽屉的选中行与
   * 底下聊天页有真实内容；从欢迎页手动打开抽屉会带 `welcome=1`，保持空态不动。
   */
  useEffect(() => {
    if (!drawerOpen || route.params.has('welcome') || autoSelectedRef.current) {
      return
    }
    if (activeId === null && sessions.length > 0) {
      autoSelectedRef.current = true
      selectSession(sessions[0].id)
    }
  }, [activeId, drawerOpen, route.params, sessions])

  const openDrawer = useCallback(() => {
    if (drawerOpen) {
      return
    }
    if (activeId === null) {
      navigate('chat-drawer', { welcome: '1' })
    } else {
      navigate('chat-drawer')
    }
  }, [activeId, drawerOpen, navigate])

  const closeDrawer = useCallback(() => navigate('chat-welcome'), [navigate])

  const selectConversation = useCallback(
    (id: string) => {
      selectSession(id)
      navigate('chat-welcome')
    },
    [navigate]
  )

  const startNewChat = useCallback(() => {
    newChat()
    navigate('chat-welcome')
  }, [navigate])

  const deleteConversation = useCallback(
    async (id: string) => {
      const ok = await removeSession(id)
      if (!ok) {
        showToast(t('sessionDeleteFailed'))
        return false
      }
      if (activeId === id) {
        newChat()
        navigate('chat-welcome')
      }
      return true
    },
    [activeId, navigate, showToast, t]
  )

  const handleSend = useCallback(() => {
    if (streaming) {
      return
    }
    if (!sendMessage(activeId)) {
      // 草稿为空时按钮本来就不可点；走到这里通常是附件还在上传。
      showToast(t('uploadFileStatusUploading'))
    }
  }, [activeId, showToast, streaming, t])

  const handleStop = useCallback(() => {
    if (activeId !== null) {
      stopReply(activeId)
    }
  }, [activeId])

  const handleCopy = useCallback(
    (text: string) => {
      void copyText(text).then((ok) => showToast(ok ? t('copied') : t('copyFailed')))
    },
    [showToast, t]
  )

  const handleOpenLink = useCallback(
    (url: string) => {
      if (isMock) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
      }
      void openExternal({ url }).catch(() => showToast(strings.openLinkFailed))
    },
    [isMock, showToast, strings.openLinkFailed]
  )

  const handleRegenerate = useCallback(
    (message: AssistantMessage) => {
      if (activeId !== null) {
        regenerateReply(activeId, message.id)
      }
    },
    [activeId]
  )

  const handleRetryUpload = useCallback(
    (message: AssistantMessage) => {
      if (activeId !== null) {
        retryUpload(activeId, message.id)
      }
    },
    [activeId]
  )

  const handleContinue = useCallback(
    (message: AssistantMessage) => {
      if (activeId !== null) {
        continueReply(activeId, message.id)
      }
    },
    [activeId]
  )

  const handleSelectVersion = useCallback(
    (messageId: string) => {
      if (activeId !== null) {
        selectMessageVersion(activeId, messageId)
      }
    },
    [activeId]
  )

  const appendVoice = useCallback(
    (text: string) => {
      const current = useDrafts.getState().drafts.get(activeId)?.text ?? ''
      setDraftText(activeId, current ? `${current} ${text}` : text)
    },
    [activeId]
  )

  const voice = useVoiceDraft(appendVoice, showToast, {
    recording: strings.voiceRecording,
    transcribing: strings.voiceTranscribing,
  })

  const onVoice = useCallback(() => {
    if (muted) {
      showToast(strings.voiceMuted)
      return
    }
    void voice.toggle()
  }, [muted, showToast, strings.voiceMuted, voice])

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) {
        return
      }
      const error = addDraftFiles(activeId, Array.from(files))
      if (error) {
        showToast(translate(error.key, error.params))
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [activeId, showToast]
  )

  const pendingUploads = draft.attachments.some(
    (attachment) => uploadTasks[attachment.id]?.status !== 'done'
  )

  const attachmentsNode =
    draft.attachments.length > 0 ? (
      <>
        {draft.attachments.map((attachment) => {
          const task = uploadTasks[attachment.id]
          const failed = task?.status === 'error'
          return (
            <AttachmentRow
              key={attachment.id}
              name={attachment.file.name}
              icon={<FileIcon size={20} />}
              error={failed}
              note={
                failed
                  ? translate(task.error.key, task.error.params)
                  : task?.status === 'uploading'
                    ? t('uploadFileStatusUploading')
                    : formatSize(attachment.file.size)
              }
              actions={
                <>
                  {failed && task.retryable ? (
                    <Button
                      variant="text"
                      size="inline"
                      onClick={() => retryDraftAttachment(activeId, attachment.id)}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                  <Button
                    variant="text"
                    size="inline"
                    onClick={() => removeDraftAttachment(activeId, attachment.id)}
                  >
                    {t('uploadDeleteFiles')}
                  </Button>
                </>
              }
            />
          )
        })}
      </>
    ) : null

  const toggles = streaming ? (
    <button type="button" className={styles.stopButton} onClick={handleStop}>
      <span className={styles.stopMark} aria-hidden="true" />
      {t('chatInputStopButtonTooltip')}
    </button>
  ) : (
    <>
      <ToggleChip on={thinking} onToggle={setThinking} icon={<ThinkIcon size={14} />}>
        {strings.deepThink}
      </ToggleChip>
      <ToggleChip on={search} onToggle={setSearch} icon={<GlobeFilledIcon size={14} />}>
        {strings.smartSearch}
      </ToggleChip>
    </>
  )

  const composer = (
    <Composer
      value={draft.text}
      onChange={(value) => setDraftText(activeId, value)}
      onSend={handleSend}
      inputLabel={strings.inputPlaceholder}
      sendLabel={t('send')}
      placeholder={strings.inputPlaceholder}
      voiceLabel={t('voiceInput')}
      attachLabel={t('uploadFile')}
      onVoice={onVoice}
      onAttach={() => fileInputRef.current?.click()}
      toggles={toggles}
      attachments={attachmentsNode}
      disabled={!ready || loadingSession || sessionLoadError}
      sendDisabled={pendingUploads}
      loading={streaming}
      hint={voice.status === 'recording' ? strings.voiceRecording : strings.disclaimer}
    />
  )

  const body = initError ? (
    <div className={styles.centerState}>
      <Notice tone="error">{t('sessionListLoadFailed')}</Notice>
      <Button variant="secondary" onClick={() => void initChat()}>
        {t('retry')}
      </Button>
    </div>
  ) : !ready ? (
    <div className={styles.centerState} role="status">
      <Spinner />
      <span>{t('sessionLoading')}</span>
    </div>
  ) : loadingSession ? (
    <div className={styles.centerState} role="status">
      <Spinner />
      <span>{t('sessionLoading')}</span>
    </div>
  ) : sessionLoadError ? (
    <div className={styles.centerState}>
      <Notice tone="error">{t('sessionLoadFailed')}</Notice>
      <Button
        variant="secondary"
        onClick={() => {
          if (activeId !== null) {
            selectSession(activeId)
          }
        }}
      >
        {t('retry')}
      </Button>
    </div>
  ) : hasMessages ? (
    <MessageList
      messages={messages}
      versions={versions}
      streaming={streaming}
      interactive={!drawerOpen}
      onSelectVersion={handleSelectVersion}
      onRegenerate={handleRegenerate}
      onRetryUpload={handleRetryUpload}
      onContinue={handleContinue}
      onCopy={handleCopy}
      onOpenLink={handleOpenLink}
      onSettings={() => navigate('data-manage')}
    />
  ) : (
    <main className={styles.welcome} aria-label={strings.welcomeAria}>
      <div className={styles.greeting}>
        <WhaleIcon size={46} className={styles.whale} />
        <h1 className={styles.greetingTitle}>{strings.greeting}</h1>
      </div>
    </main>
  )

  return (
    <div className={styles.screen} ref={rootRef}>
      <div className={`${styles.pageSurface} ${drawerOpen ? styles.pagePushed : ''}`}>
        <div className={styles.pageDim} aria-hidden={drawerOpen || undefined}>
          <ChatTopBar
            title={title}
            left={
              <IconButton label={strings.openDrawer} size="lg" onClick={openDrawer}>
                <MenuIcon size={22} />
              </IconButton>
            }
            right={
              <div className={styles.barActions}>
                {hasMessages ? null : (
                  <IconButton
                    label={muted ? strings.unmute : strings.mute}
                    size="lg"
                    aria-pressed={muted}
                    onClick={() => {
                      setMuted((value) => !value)
                      showToast(muted ? strings.unmuted : strings.muted)
                    }}
                  >
                    <MuteIcon size={24} />
                  </IconButton>
                )}
                <IconButton label={t('newChat')} size="lg" onClick={startNewChat}>
                  <NewChatIcon size={20} />
                </IconButton>
              </div>
            }
          />
          {saveError ? (
            <div className={styles.saveBanner}>
              <Notice tone="error" actions={[{ label: t('retry'), onClick: retrySaveSessions }]}>
                {t('sessionSaveFailed')}
              </Notice>
            </div>
          ) : null}
          {body}
          {composer}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className={styles.fileInput}
          tabIndex={-1}
          onChange={(event) => onFiles(event.target.files)}
        />
      </div>

      {drawerOpen ? (
        <DrawerPanel
          sessions={sessions}
          activeId={activeId}
          account={account}
          onClose={closeDrawer}
          onSelect={selectConversation}
          onDelete={deleteConversation}
          onAccount={() => navigate('account-manage')}
        />
      ) : null}
    </div>
  )
}

/**
 * chat-welcome / chat-drawer 必须是同一个组件引用，路由切换时 React 才会复用实例，
 * 抽屉的推移动画与聊天滚动位置都不会被重置。
 */
export const ChatWelcomeScreen = ChatScreen
export const ChatDrawerScreen = ChatScreen
