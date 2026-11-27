import { useId } from 'react'
import type { ReactNode } from 'react'
import { translate } from '../../i18n/index.js'
import { cx } from './cx.js'
import { Radio } from './Radio.js'
import styles from './Dialog.module.css'

/**
 * 居中确认弹窗（visual §5.4）：遮罩 32% 黑、面板宽 300、圆角 20、`--card` 底。
 * 标题 17/600/24、上内边距 22；正文 14/21 `--ink-2`；动作区 52 高、两等分，
 * 取消在左（`--ink-2`），确认在右（默认品牌蓝，破坏性动作改红字，不做实心红块）。
 *
 * 分隔线按示意图写死 rgba(0,0,0,.08)——暗色下示意没有覆盖它，这条线会很淡；
 * 保持示意原值，免得同一份示意与实现出现两套明暗规则。
 */
export interface DialogProps {
  open: boolean
  title: ReactNode
  body?: ReactNode
  /** 取消按钮文案；弹窗必须能退出 */
  cancelLabel: string
  confirmLabel: string
  danger?: boolean
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export const Dialog = ({
  open,
  title,
  body,
  cancelLabel,
  confirmLabel,
  danger = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: DialogProps) => {
  const titleId = useId()
  if (!open) {
    return null
  }
  return (
    <div className={styles.layer}>
      <button
        type="button"
        className={styles.scrim}
        aria-label={translate('close')}
        onClick={onCancel}
      />
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <p className={cx(styles.title, body ? '' : styles.titleOnly)} id={titleId}>
          {title}
        </p>
        {body ? <p className={styles.body}>{body}</p> : null}
        <div className={styles.actions}>
          <button type="button" className={cx(styles.action, styles.cancel)} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cx(styles.action, danger ? styles.danger : styles.confirm)}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

/**
 * 单选弹窗（官方 64/65）：可选图标 + 标题 + 选项列表 + 整行确认。
 * 没有正文、没有取消按钮：点遮罩退出，确认行始终在底部（52 高蓝字）。
 */
export interface ChoiceDialogProps {
  open: boolean
  title: ReactNode
  options: ReadonlyArray<{ value: string; label: ReactNode }>
  value: string
  onSelect: (value: string) => void
  confirmLabel: string
  icon?: ReactNode
  onConfirm: () => void
  onCancel?: () => void
}

export const ChoiceDialog = ({
  open,
  title,
  options,
  value,
  onSelect,
  confirmLabel,
  icon,
  onConfirm,
  onCancel,
}: ChoiceDialogProps) => {
  const titleId = useId()
  if (!open) {
    return null
  }
  return (
    <div className={styles.layer}>
      <button
        type="button"
        className={styles.scrim}
        aria-label={translate('close')}
        onClick={onCancel}
      />
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {icon ? <div className={styles.icon}>{icon}</div> : null}
        <p className={cx(styles.title, icon ? styles.titleWithIcon : '')} id={titleId}>
          {title}
        </p>
        <div className={styles.list} role="radiogroup">
          {options.map((option) => {
            const checked = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                className={styles.option}
                onClick={() => onSelect(option.value)}
              >
                <Radio checked={checked} />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
        <button type="button" className={styles.confirm} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </section>
    </div>
  )
}
