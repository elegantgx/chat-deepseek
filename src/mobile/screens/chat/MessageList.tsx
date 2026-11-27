import { useCallback, useEffect, useRef } from 'react'
import type { MessageVersions } from '../../../services/chat/branches.js'
import type { AssistantMessage, Message } from '../../../services/chat/types.js'
import { ScrollToBottomContext } from '../../../components/messages/scrollContext.js'
import { MessageItem } from './MessageItem.js'
import styles from './ChatScreen.module.css'

export interface MessageListProps {
  messages: Message[]
  versions: ReadonlyMap<string, MessageVersions>
  streaming: boolean
  interactive: boolean
  onSelectVersion: (messageId: string) => void
  onRegenerate: (message: AssistantMessage) => void
  onRetryUpload: (message: AssistantMessage) => void
  onContinue: (message: AssistantMessage) => void
  onCopy: (text: string) => void
  onOpenLink: (url: string) => void
  onSettings: () => void
}

/** 距离底部多少以内算“跟着新内容走”；用户上滑后就不再抢滚动位置 */
const PIN_THRESHOLD = 96

/**
 * 消息列表：普通滚动容器 + `content-visibility` 跳过屏外排版。
 *
 * 不引入虚拟列表依赖：一屏消息数量有限，虚拟化会带来测量、键盘与分支切换的额外状态；
 * 先靠 CSS 的 content-visibility 把屏外渲染成本降下来，真机上滚动手感也更稳。
 * Markdown 解析完会通过 ScrollToBottomContext 请求一次滚动，这里只跟随“贴底”状态。
 */
export const MessageList = ({
  messages,
  versions,
  streaming,
  interactive,
  onSelectVersion,
  onRegenerate,
  onRetryUpload,
  onContinue,
  onCopy,
  onOpenLink,
  onSettings,
}: MessageListProps) => {
  const listRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    const element = listRef.current
    if (element && pinnedRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [])

  const onScroll = useCallback(() => {
    const element = listRef.current
    if (!element) {
      return
    }
    pinnedRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= PIN_THRESHOLD
  }, [])

  // 新消息、切换分支、开始/结束生成都可能改变高度；只有仍贴底时才跟随。
  // content-visibility 与 Markdown 节流会让高度在首帧之后才长出来，所以先等一帧，
  // 再用 ResizeObserver 跟随内容高度（流式正文、代码高亮、字体加载都走这条）。
  useEffect(() => {
    const frame = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(frame)
  }, [messages.length, streaming, scrollToBottom])

  useEffect(() => {
    const inner = innerRef.current
    if (!inner) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [scrollToBottom])

  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')

  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={listRef} className={styles.messageList} onScroll={onScroll}>
        <div ref={innerRef} className={styles.messageInner}>
          {messages.map((message) => {
            const messageStreaming =
              streaming && message.role === 'assistant' && message.id === lastAssistant?.id
            return (
              <MessageItem
                key={message.id}
                message={message}
                streaming={messageStreaming}
                interactive={interactive}
                versions={versions.get(message.id)}
                onSelectVersion={onSelectVersion}
                onRegenerate={onRegenerate}
                onRetryUpload={onRetryUpload}
                onContinue={onContinue}
                onCopy={onCopy}
                onOpenLink={onOpenLink}
                onSettings={onSettings}
              />
            )
          })}
        </div>
      </div>
    </ScrollToBottomContext.Provider>
  )
}
