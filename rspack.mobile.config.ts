import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Configuration } from '@rspack/core'

/**
 * Android mobile Web 的构建配置（产物只进 APK，不混进浏览器包）。
 *
 * 关键差异（相对 `rspack.config.ts`）：
 * - 入口是 `src/mobile/main.tsx`，输出 `dist-mobile/`；
 * - `publicPath` 用相对路径：WebView 从 `https://appassets.androidplatform.net/assets/`
 *   加载，file:// 预览也不能出现绝对 `/`；
 * - 关掉代码分割，首版只出一个 bundle，减少 WebView 里的资源请求；
 * - CSP 写死在 `src/mobile/index.html` 里，构建不生成也不放宽。
 */

const root = path.dirname(fileURLToPath(import.meta.url))
const targets = ['chrome >= 105']

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

const config: Configuration = {
  mode: 'production',
  entry: './src/mobile/main.tsx',
  output: {
    path: path.resolve(root, 'dist-mobile'),
    // 相对路径：index.html 在 assets 根，静态资源统一在 ./static 下
    publicPath: './',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: false,
  // WebView 里没有 dev server，异步模块预编译无意义
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 与主构建一致：把 .js 导入路径解析到同名 .ts/.tsx
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: false } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
    ],
  },
  optimization: {
    // 首版单 bundle：避免 WebView 里为几 KB 的壳再发一堆请求
    splitChunks: false,
    runtimeChunk: false,
    minimize: true,
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: './src/mobile/index.html',
      scriptLoading: 'defer',
    }),
  ],
  performance: { hints: false },
}

// eslint-disable-next-line import/no-default-export
export default defineConfig(config)
