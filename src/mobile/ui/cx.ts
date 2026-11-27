/** 拼接 className：组件里条件变体多，集中一处避免每处写 filter(Boolean) */
export const cx = (...values: Array<string | false | null | undefined>): string =>
  values.filter(Boolean).join(' ')
