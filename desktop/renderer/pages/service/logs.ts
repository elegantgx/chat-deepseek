/** 把 `service.logs` / `event.service.log` 的原始行转成 `LogPane` 的行结构。 */
import type { LogLevel, LogLine } from '../../ui'

/** 行里带时间就沿用，不带（事件流常见）就用当前时刻 */
const RAW_LINE = /^(?:\[?(\d{2}:\d{2}:\d{2})\]?\s+)?(INFO|WARN|ERROR)\s+([\s\S]*)$/

const LEVELS: Record<string, LogLevel> = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
}

const pad = (value: number): string => String(value).padStart(2, '0')

export function clockTime(value = new Date()): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
}

export function parseLogLine(raw: string, fallbackTime = clockTime()): LogLine {
  const line = raw.trim()
  const match = RAW_LINE.exec(line)
  if (!match) {
    return { time: fallbackTime, level: 'info', message: line }
  }
  return {
    time: match[1] ?? fallbackTime,
    level: LEVELS[match[2]],
    message: match[3],
  }
}
