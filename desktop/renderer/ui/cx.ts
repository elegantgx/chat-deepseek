/** 拼接 class：只接受字符串和假值，避免把 undefined 写进 className。 */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ')
}
