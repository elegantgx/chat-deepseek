/** 备份列表的显示格式：不引日期库，按本地时区手写。 */

const pad = (value: number): string => String(value).padStart(2, '0')

/** RFC 3339 → `2026-11-27 01:44`（本地时区） */
export function formatBackupTime(rfc3339: string): string {
  const value = new Date(rfc3339)
  if (Number.isNaN(value.getTime())) {
    return '—'
  }
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}`
  )
}

/** 字节数 → `48.2 MB`；小于 1 KB 时不带小数 */
export function formatBackupSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** IPC 错误 → `{code}: {message}`，页面只展示这一层，不解析 message 做逻辑 */
export function formatFailure(failure: { code: string; message: string }): string {
  return `${failure.code}: ${failure.message}`
}
