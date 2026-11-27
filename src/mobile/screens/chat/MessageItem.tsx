import { useEffect, useState } from 'react'
import type { MessageVersions } from '../../../services/chat/branches.js'
import type {
  AssistantMessage as AssistantMessageType,
  Message,
  UserMessage as UserMessageType,
} from '../../../services/chat/types.js'
import { canContinueReply } from '../../../services/chat/reply.js'
import { describeReply } from '../../../services/chat/describe.js'
import { getAreaTitle } from '../../../services/chat/view.js'
import { useReplyView } from '../../../components/messages/useReplyView.js'
import { formatSize } from '../../../services/attachments.js'
import { Markdown } from '../../../components/markdown/Markdown.js'
import { translate } from '../../../i18n/index.js'
import {
  AssistantMessage,
  AttachmentRow,
  ChevronRightIcon,
  MessageAction,
  MessageActions,
  Notice,
  Quote,
  ThinkingBlock,
  UserBubble,
} from '../../ui/index.js'
import { useStrings } from '../strings.js'
import { chatStrings } from './strings.js'
import styles from './ChatScreen.module.css'

export interface MessageItemProps {
  message: Message
  streaming: boolean
  /** 抽屉打开时底下的是不可操作的回放页，隐藏行内动作，避免隔着蒙层误触 */
  interactive: boolean
  versions?: MessageVersions
  onSelectVersion: (messageId: string) => void
  onRegenerate: (message: AssistantMessageType) => void
  onRetryUpload: (message: AssistantMessageType) => void
  onContinue: (message: AssistantMessageType) => void
  onCopy: (text: string) => void
  onOpenLink: (url: string) => void
  onSettings: () => void
}

/**
 * 一条消息的展示壳：用户走气泡，助手走无底消息 + 思考/正文/引用/动作。
 *
 * 为什么正文仍然交给 `components/markdown`：解析、节流、引用角标、KaTeX/Mermaid 都在
 * 那边，屏里再写一套一定会和主站漂移；这里只负责 mobile 的排版与行内动作。
 */
export const MessageItem = (props: MessageItemProps) => {
  if (props.message.role === 'user') {
    return <UserMessage message={props.message} />
  }
  return <AssistantMessageItem {...props} message={props.message} />
}

const UserMessage = ({ message }: { message: UserMessageType }) => (
  <article className={styles.message} data-message-id={message.id}>
    <UserBubble className={styles.userBubble}>
      {message.content ? <span className={styles.userText}>{message.content}</span> : null}
      {message.files.length > 0 ? (
        <div className={styles.userFiles}>
          {message.files.map((file) => (
            <AttachmentRow
              key={file.id}
              name={file.name}
              note={formatSize(file.size)}
              className={styles.userFile}
            />
          ))}
        </div>
      ) : null}
    </UserBubble>
  </article>
)

const AssistantMessageItem = ({
  message,
  streaming,
  interactive,
  versions,
  onSelectVersion,
  onRegenerate,
  onRetryUpload,
  onContinue,
  onCopy,
  onOpenLink,
  onSettings,
}: Omit<MessageItemProps, 'message'> & { message: AssistantMessageType }) => {
  const strings = useStrings(chatStrings)
  const view = useReplyView(message, streaming)
  const tick = useTickValue(streaming)

  const notice = streaming ? null : describeReply(message)
  const refused = message.stopReason === 'refusal'
  const answer = refused ? null : view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const thinkingBlocks = view.steps.flatMap((step) => (step.type === 'thinking' ? step.blocks : []))
  const thinkingText = thinkingBlocks.map((block) => block.thinking).join('\n\n')
  const thinkingTitle =
    thinkingBlocks.length > 0
      ? getAreaTitle(view, streaming, Date.now() + tick * 1200, !!answer)
      : null
  const waiting = streaming && !thinkingText && !answer && !notice
  const actionsVisible = interactive && !streaming
  const canRetry = message.status === 'error'

  return (
    <article className={styles.message} data-message-id={message.id}>
      <AssistantMessage
        actions={
          actionsVisible ? (
            <div className={styles.footer}>
              {versions && versions.ids.length > 1 ? (
                <div className={styles.versions} aria-label={translate('messageVersions')}>
                  <button
                    type="button"
                    className={styles.versionButton}
                    aria-label={translate('previousVersion')}
                    disabled={versions.index <= 0}
                    onClick={() => onSelectVersion(versions.ids[versions.index - 1])}
                  >
                    <ChevronRightIcon size={14} className={styles.versionPrev} />
                  </button>
                  <span className={styles.versionCount}>
                    {versions.index + 1} / {versions.ids.length}
                  </span>
                  <button
                    type="button"
                    className={styles.versionButton}
                    aria-label={translate('nextVersion')}
                    disabled={versions.index >= versions.ids.length - 1}
                    onClick={() => onSelectVersion(versions.ids[versions.index + 1])}
                  >
                    <ChevronRightIcon size={14} />
                  </button>
                </div>
              ) : null}
              <MessageActions>
                {responseText ? (
                  <MessageAction label={translate('copy')} onClick={() => onCopy(responseText)}>
                    {translate('copy')}
                  </MessageAction>
                ) : null}
                <MessageAction
                  label={translate('regenerate')}
                  onClick={() => onRegenerate(message)}
                >
                  {translate('regenerate')}
                </MessageAction>
                {canContinueReply(message) ? (
                  <MessageAction
                    label={translate('continueGenerating')}
                    onClick={() => onContinue(message)}
                  >
                    {translate('continueGenerating')}
                  </MessageAction>
                ) : null}
              </MessageActions>
            </div>
          ) : undefined
        }
      >
        {thinkingText ? (
          <ThinkingBlock
            label={thinkingTitle ?? translate('messageThinking')}
            defaultOpen={streaming}
          >
            <Markdown
              className={styles.thinkingMarkdown}
              content={thinkingText}
              loading={streaming}
              cacheKey={`${message.id}-thinking`}
              disableLink={false}
            />
          </ThinkingBlock>
        ) : null}
        {answer ? (
          <Markdown
            className={styles.markdown}
            content={answer.markdown}
            loading={streaming}
            cacheKey={message.id}
            disableLink={false}
            sources={view.sources}
          />
        ) : null}
        {waiting ? (
          <div className={styles.waiting} role="status" aria-label={translate('messageThinking')}>
            <span className={styles.waitingDot} />
            <span className={styles.waitingDot} />
            <span className={styles.waitingDot} />
          </div>
        ) : null}
        {notice?.presentation === 'response' ? (
          <Markdown
            className={styles.markdown}
            content={notice.text}
            loading={false}
            cacheKey={`${message.id}-template`}
            disableLink={false}
          />
        ) : notice ? (
          <Notice
            tone="error"
            actions={
              canRetry
                ? [
                    {
                      label: translate('retry'),
                      onClick: () =>
                        message.error?.kind === 'upload'
                          ? onRetryUpload(message)
                          : onRegenerate(message),
                    },
                  ]
                : undefined
            }
            className={styles.notice}
          >
            {notice.text}
            {notice.action === 'apiKey' ? (
              <>
                {' '}
                <button type="button" className={styles.noticeLink} onClick={onSettings}>
                  {translate('changeApiKey')}
                </button>
              </>
            ) : null}
          </Notice>
        ) : null}
        {refused ? null : view.sources.length > 0 ? (
          <Quote className={styles.sources}>
            <div className={styles.sourceTitle}>{strings.sourceTitle}</div>
            {view.sources.map((source) => (
              <button
                key={source.url}
                type="button"
                className={styles.sourceLink}
                onClick={() => onOpenLink(source.url)}
              >
                {source.title}
              </button>
            ))}
          </Quote>
        ) : null}
      </AssistantMessage>
    </article>
  )
}

/**
 * 思考用时的 tick：流式时每 1.2 秒强制一次重绘，结束态返回常量。
 * 独立成 hook 是为了让多条消息各自订阅，不因其中一条停止而拖住另一条。
 */
const useTickValue = (streaming: boolean) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!streaming) {
      return
    }
    const timer = setInterval(() => setTick((value) => value + 1), 1200)
    return () => clearInterval(timer)
  }, [streaming])
  return tick
}
