import { useId } from 'react'
import styles from './Field.module.css'
import { cx } from './cx'

export type FieldType = 'text' | 'password'

export interface FieldProps {
  label: string
  value: string
  /** 不传 onChange 视作只读：避免出现「有 value 没 onChange」的受控告警 */
  onChange?: (value: string) => void
  type?: FieldType
  placeholder?: string
  name?: string
  autoComplete?: string
  autoFocus?: boolean
  readOnly?: boolean
  disabled?: boolean
  /** 只改视觉并置 aria-invalid，不显示错误文案（错误态样本用） */
  invalid?: boolean
  /** 错误文案；传了就会同时置 aria-invalid 并显示在下方 */
  error?: string
  hint?: string
  mono?: boolean
  fullWidth?: boolean
  className?: string
  id?: string
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  name,
  autoComplete,
  autoFocus,
  readOnly,
  disabled,
  invalid,
  error,
  hint,
  mono,
  fullWidth,
  className,
  id,
}: FieldProps) {
  const generatedId = useId()
  const inputId = id ?? `${generatedId}-field`
  const messageId = `${inputId}-message`
  const isInvalid = invalid === true || error !== undefined
  const isReadOnly = readOnly === true || onChange === undefined
  const message = error ?? hint

  return (
    <div className={cx(styles.field, fullWidth && styles.fullWidth, className)}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={cx(
          styles.input,
          mono && styles.mono,
          isReadOnly && styles.readOnly,
          isInvalid && styles.invalid,
          disabled && styles.disabled
        )}
        type={type}
        value={value}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        readOnly={isReadOnly}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        aria-describedby={message ? messageId : undefined}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      />
      {message ? (
        <p
          id={messageId}
          className={isInvalid ? styles.error : styles.hint}
          role={isInvalid ? 'alert' : undefined}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
