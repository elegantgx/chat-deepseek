import type { Configuration } from '@rspack/core'

// 配置必须用 require：desktop 是 CJS 作用域，见文件头注释
/* oxlint-disable typescript/no-var-requires */

/**
 * 桌面渲染进程的构建配置。
 *
 * 这里刻意用 CJS 写法（require / module.exports）：desktop/package.json 声明了
 * "type": "commonjs"（Electron 主进程与 sandbox preload 必须是 CJS），在这个作用域里
 * 用 ESM 语法会让 Node 原生加载器先报一次「Failed to load the ES module」再回退。
 */
const path = require('node:path') as typeof import('node:path')
const { rspack } = require('@rspack/core') as typeof import('@rspack/core')

const dev = process.env.NODE_ENV !== 'production'
const targets = ['chrome >= 105', 'edge >= 105', 'safari >= 16', 'firefox >= 110']
const desktopRoot = __dirname

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

const config: Configuration = {
  mode: dev ? 'development' : 'production',
  // 渲染层是标准 Web 页面：Electron 里由 file:// 加载，不碰 Node 能力
  target: 'web',
  entry: path.resolve(desktopRoot, 'renderer/main.tsx'),
  output: {
    path: path.resolve(desktopRoot, 'dist/renderer'),
    // file:// 下按脚本自身位置推导资源地址
    publicPath: 'auto',
    filename: 'assets/[name].[contenthash:8].js',
    chunkFilename: 'assets/[name].[contenthash:8].js',
    cssFilename: 'assets/[name].[contenthash:8].css',
    cssChunkFilename: 'assets/[name].[contenthash:8].css',
    assetModuleFilename: 'assets/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
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
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
      { test: /\.(png|jpe?g|svg|webp)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: path.resolve(desktopRoot, 'renderer/index.html'),
      // file:// 下 classic 脚本会因协议受限，defer 脚本按相对路径加载才正常
      scriptLoading: 'defer',
    }),
  ],
  performance: { hints: false },
  // 仅开发用：配合 CHAT_DEEPSEEK_RENDERER_URL 获取 HMR；build 不读它
  devServer: {
    port: 8092,
    historyApiFallback: true,
  },
}

module.exports = config
