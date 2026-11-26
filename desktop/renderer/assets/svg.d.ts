/**
 * rspack 的 asset/resource 把 svg 变成产物的 URL；tsconfig 的 types 为空，
 * 没有框架自带的声明，这里补一条，tsx 才能直接 import。
 */
declare module '*.svg' {
  const url: string
  export default url
}
