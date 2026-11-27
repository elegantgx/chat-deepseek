import type { ScreenRegistry } from '../registry.js'
import { ChatScreen } from './ChatScreen.js'

/**
 * 聊天两屏的出口。
 *
 * `chat-welcome` 与 `chat-drawer` 是同一个组件的两个路由状态（抽屉开合），
 * 所以注册表片段里两个 id 指向同一引用；React 在 hash 变化时复用实例。
 * 与其它屏组一样导出 `screens`，由根 agent 统一 merge。
 */
export { ChatScreen, ChatDrawerScreen, ChatWelcomeScreen } from './ChatScreen.js'

export const chatScreens: Partial<ScreenRegistry> = {
  'chat-welcome': ChatScreen,
  'chat-drawer': ChatScreen,
}

export const screens: Partial<ScreenRegistry> = chatScreens
