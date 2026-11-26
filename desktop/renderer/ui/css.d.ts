/**
 * rspack 的 css / css/module 规则由打包器处理，TypeScript 只关心模块形状。
 * 这里给出最小声明，让 tsc --noEmit 能通过；类名在构建期由 CSS Modules 生成。
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'
