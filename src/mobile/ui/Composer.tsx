import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { cx } from './cx.js'
import { ClipIcon, FileIcon, MicIcon, SendIcon } from './icons.js'
import { Spinner } from './Spinner.js'
import styles from './Composer.module.css'

/**
 * 输入区外壳（mockup `.composer` / `.function-row` / `.toggle` / `.send-btn` / `.caveat`）。
 *
 * 几何逐字取自示意：外框 24 圆角 + 1px 描边 + 输入卡阴影；输入行 16/24、上内边距 12；
 * 功能行间距 8、内边距 12；开关 chip 34 高；语音/附件 34 圆；发送键 34 品牌圆、左距 6。
 * 附件行与字数/模型提示是示意后补的零件：附件行按 `.attach-row`（`--fill-2`、12 圆角、
 * 失败转红边），提示按 11/16 `--ink-4`。附件行放在输入卡上沿之外，不跟边框抢空间。
 *
 * 输入框随内容长高到 120 就内部滚动；发送键在空输入/发送中/显式禁用时不可点。
 */
export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  /** 输入框读屏名（已翻译） */
  inputLabel: string
  /** 发送键读屏名（已翻译） */
  sendLabel: string
  placeholder?: string
  /** 语音/附件键的读屏名；不给对应回调就不渲染按钮 */
  voiceLabel?: string
  attachLabel?: string
  onVoice?: () => void
  onAttach?: () => void
  /** 深度思考 / 智能搜索等开关，用 ToggleChip 组合 */
  toggles?: ReactNode
  /** 附件清单，用 AttachmentRow 组合；渲染在输入卡上沿之外 */
  attachments?: ReactNode
  /** 断开/不可用时禁用输入与所有动作；仅想禁发送用 sendDisabled */
  disabled?: boolean
  sendDisabled?: boolean
  /** 发送中：发送键换成转圈 */
  loading?: boolean
  maxLength?: number
  /** 左侧模型提示，例如“DeepSeek V3” */
  model?: ReactNode
  /** 底部说明/免责声明 */
  hint?: ReactNode
  className?: string
}

export const Composer = ({
  value,
  onChange,
  onSend,
  inputLabel,
  sendLabel,
  placeholder,
  voiceLabel,
  attachLabel,
  onVoice,
  onAttach,
  toggles,
  attachments,
  disabled = false,
  sendDisabled = false,
  loading = false,
  maxLength,
  model,
  hint,
  className,
}: ComposerProps) => {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 内容变化时先复位再量 scrollHeight，否则删字后高度不会收回去；上限 120 后交给内部滚动
  useEffect(() => {
    const element = inputRef.current
    if (!element) {
      return
    }
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`
  }, [value])

  const blocked = disabled || loading || sendDisabled || value.trim().length === 0
  const showMeta = Boolean(model) || Boolean(maxLength)

  return (
    <div className={cx(styles.dock, className)}>
      {attachments ? <div className={styles.attachments}>{attachments}</div> : null}
      <div className={cx(styles.composer, disabled ? styles.disabled : '')}>
        <textarea
          ref={inputRef}
          rows={1}
          className={styles.input}
          value={value}
          placeholder={placeholder}
          aria-label={inputLabel}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className={styles.functions}>
          <div className={styles.toggles}>{toggles}</div>
          <div className={styles.right}>
            {onVoice && voiceLabel ? (
              <button
                type="button"
                className={styles.tool}
                aria-label={voiceLabel}
                disabled={disabled}
                onClick={onVoice}
              >
                <MicIcon size={16} />
              </button>
            ) : null}
            {onAttach && attachLabel ? (
              <button
                type="button"
                className={styles.tool}
                aria-label={attachLabel}
                disabled={disabled}
                onClick={onAttach}
              >
                <ClipIcon size={16} />
              </button>
            ) : null}
            <button
              type="button"
              className={cx(styles.send, blocked ? styles.sendDisabled : '')}
              aria-label={sendLabel}
              aria-disabled={blocked || undefined}
              disabled={blocked}
              onClick={onSend}
            >
              {loading ? <Spinner size="sm" /> : <SendIcon size={16} />}
            </button>
          </div>
        </div>
      </div>
      {hint || showMeta ? (
        <div className={styles.caveat}>
          {model ? <span className={styles.meta}>{model}</span> : null}
          <span className={styles.hint}>{hint}</span>
          {maxLength ? (
            <span className={styles.count}>
              {value.length}/{maxLength}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 输入区开关 chip（mockup `.toggle`）：34 高、18 圆角、1px 描边、13/500；
 * 打开时品牌淡底 + 品牌描边 + 品牌字。
 */
export interface ToggleChipProps {
  on: boolean
  children: ReactNode
  onToggle?: (next: boolean) => void
  icon?: ReactNode
  disabled?: boolean
  className?: string
}

export const ToggleChip = ({
  on,
  children,
  onToggle,
  icon,
  disabled = false,
  className,
}: ToggleChipProps) => (
  <button
    type="button"
    className={cx(styles.toggle, on ? styles.toggleOn : '', className)}
    aria-pressed={on}
    disabled={disabled}
    onClick={() => onToggle?.(!on)}
  >
    {icon}
    {children}
  </button>
)

/**
 * 待发送附件行（mockup `.attach-row`）：`--fill-2` 底、12 圆角、10 12 内边距，
 * 上方是文件图标、文件名（14/20 主文字）、百分比（等宽 12）；下方是说明与 4px 进度条；
 * 右侧文字动作（重试/移除）由组合方传，行高不因失败态变化，只换红边与红字。
 */
export interface AttachmentRowProps {
  name: string
  icon?: ReactNode
  /** 上传进度 0–100；给了就画 4px 进度条和右侧百分比 */
  percent?: number
  /** 文件名下一行的 12/16 说明（大小、失败原因） */
  note?: ReactNode
  error?: boolean
  /** 行尾文字动作，建议用 Button variant="text" size="inline" */
  actions?: ReactNode
  className?: string
}

export const AttachmentRow = ({
  name,
  icon,
  percent,
  note,
  error = false,
  actions,
  className,
}: AttachmentRowProps) => (
  <div className={cx(styles.attachRow, error ? styles.attachFailed : '', className)}>
    <span className={styles.attachIcon}>{icon ?? <FileIcon size={20} />}</span>
    <div className={styles.attachMain}>
      <div className={styles.attachHead}>
        <span className={styles.attachTitle}>{name}</span>
        {percent === undefined || error ? null : (
          <span className={styles.attachPercent}>{`${Math.round(percent)}%`}</span>
        )}
        {actions ? <div className={styles.attachActions}>{actions}</div> : null}
      </div>
      {note ? <div className={styles.attachNote}>{note}</div> : null}
      {percent !== undefined && !error ? (
        <div className={styles.attachProgress}>
          <span
            className={styles.attachBar}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      ) : null}
    </div>
  </div>
)
