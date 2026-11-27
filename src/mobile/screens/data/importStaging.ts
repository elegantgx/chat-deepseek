/**
 * 导入确认屏要跨路由拿到用户刚选的文件。
 *
 * 文件对象不能塞进 hash 参数（会被字符串化或撑爆 URL），所以放在模块内存里：
 * 数据管理页选完文件后写入，确认屏读它，成功/取消后由确认屏清空。刷新页面或直接打开确认屏时为空，
 * 此时确认按钮会再拉起一次文件选择，保证按钮永远不是空动作。
 */
let pendingImportFile: File | null = null

export const stageImportFile = (file: File | null): void => {
  pendingImportFile = file
}

export const getImportFile = (): File | null => pendingImportFile

export const clearImportFile = (): void => {
  pendingImportFile = null
}
