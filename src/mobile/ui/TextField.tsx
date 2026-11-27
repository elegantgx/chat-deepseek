import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { cx } from './cx.js'
import styles from './TextField.module.css'

/**
 * 三种输入形态，全部逐字取自示意：
 * - form：48 高、12 圆角、`--fill` 底、等宽 13.5（地址、主机参数），
 *   占位文案用 UI 字体 15 避免等宽把 placeholder 拉散；
 * - pill：56 高、28 圆角、`--fill-2` 底、17（建账户、API Key），字段间距 12；
 * - login：几何同 pill，字段间距 18（登录页）。
 * 错误态只加内描边 1.5 红，不改尺寸；说明文案在框下 12/18，左边距 4。
 */
export type FieldVariant = 'form' | 'pill' | 'login'

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'className'
> {
  /** 框上方标签（13/18 --ink-3），表单卡里用 */
  label?: ReactNode
  /** 框下说明（12/18 --ink-3） */
  hint?: ReactNode
  /** 真的写错时才传；同时给红圈和红字，不改变控件尺寸 */
  error?: ReactNode
  /** 只标红圈、不写字（登录页两个框都红，错误说明在整组下方用 FormError） */
  invalid?: boolean
  variant?: FieldVariant
  /** 等宽输入（地址、版本、路径）。password 自动按点的大小处理 */
  mono?: boolean
  /** 只读：文字退成 --ink-3，提示不可改 */
  readOnly?: boolean
  className?: string
}

export const TextField = ({
  label,
  hint,
  error,
  invalid = false,
  variant = 'form',
  mono = false,
  readOnly = false,
  className,
  id,
  type = 'text',
  ...rest
}: TextFieldProps) => {
  const fallbackId = useId()
  const inputId = id ?? fallbackId
  return (
    <div className={cx(styles.root, styles[variant], className)}>
      {label ? (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div
        className={cx(
          styles.wrapper,
          error || invalid ? styles.wrapperError : '',
          mono || type === 'password' ? styles.mono : '',
          readOnly ? styles.readonly : ''
        )}
      >
        <input
          id={inputId}
          type={type}
          readOnly={readOnly}
          aria-invalid={error || invalid ? true : undefined}
          className={cx(styles.input, type === 'password' ? styles.password : '')}
          {...rest}
        />
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  )
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type'>

/** 密码框：占位点固定 11px + 字距 3（示意 `.pw`），否则点会跟着输入框字号又黑又重 */
export const PasswordField = (props: PasswordFieldProps) => <TextField type="password" {...props} />

export interface TextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'className'
> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
}

/**
 * 多行输入。示意里没有现成画法（36 屏都只用单行），沿用表单卡的语言：
 * `--fill` 底、12 圆角、12 14 内边距、15/22，最小高 96。
 */
export const Textarea = ({
  label,
  hint,
  error,
  className,
  id,
  rows = 4,
  ...rest
}: TextareaProps) => {
  const fallbackId = useId()
  const inputId = id ?? fallbackId
  return (
    <div className={cx(styles.root, styles.form, styles.textareaRoot, className)}>
      {label ? (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div className={cx(styles.wrapper, styles.textareaWrapper, error ? styles.wrapperError : '')}>
        <textarea
          id={inputId}
          rows={rows}
          aria-invalid={error ? true : undefined}
          className={styles.textarea}
          {...rest}
        />
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  )
}

/**
 * 整组输入下方的错误行（mockup `.form-error`）：12/18、左边距 4、上距 12。
 * 登录失败时两个框只标红圈（TextField invalid），说明文字统一放这里，
 * 避免一行错误重复两次。
 */
export const FormError = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cx(styles.formError, className)}>{children}</p>
)

/**
 * 表单页脚说明（mockup `.login-note` / `.form-note`）：12/18 `--ink-3`、上距 20。
 * 默认居中（登录页），`align="start"` 左对齐并缩进 16（表单页脚注）。
 */
export interface FormNoteProps {
  children: ReactNode
  align?: 'center' | 'start'
  inset?: boolean
  className?: string
}

export const FormNote = ({
  children,
  align = 'center',
  inset = false,
  className,
}: FormNoteProps) => (
  <p
    className={cx(
      styles.formNote,
      align === 'start' ? styles.formNoteStart : '',
      inset ? styles.formNoteInset : '',
      className
    )}
  >
    {children}
  </p>
)
