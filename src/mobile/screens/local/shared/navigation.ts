import { resolveScreenParam } from '../../registry.js'
import type { ScreenId } from '../../registry.js'

/**
 * 二级页的返回目标来自路由参数 `from`（选中服务器的各入口都会传它），
 * 直接打开 URL 或参数非法时退回各屏给的默认父级。
 * 只在本地组内用，不改变 registry 的屏清单。
 */
export const resolveFrom = (value: string | null | undefined, fallback: ScreenId): ScreenId =>
  resolveScreenParam(value) ?? fallback
