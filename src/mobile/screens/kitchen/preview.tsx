import { createRoot } from 'react-dom/client'
import { applyTheme, installTheme } from '../../app/theme.js'
import '../../app/global.css'
import { KitchenScreen } from './KitchenScreen.js'

/**
 * 自查页的临时入口（不参与 `pnpm build:mobile`）：
 * 由 `tmp/rspack.kitchen.config.ts` 单独构建，用来在挂路由之前截图对比。
 * 根 agent 把 KitchenScreen 挂进 registry 后，这个文件与 tmp 配置都可以删。
 */
installTheme()
applyTheme(new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light')

const container = document.getElementById('root')
if (!container) {
  throw new Error('kitchen 预览入口缺少 #root')
}

createRoot(container).render(
  <div style={{ display: 'flex', height: '100%' }}>
    <KitchenScreen />
  </div>
)
