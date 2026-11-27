import { BackupDetailView } from './BackupDetailView.js'

/** 删除备份确认（#25）：确认后回列表，由列表页执行删除并显示行内转圈 */
export const ServerBackupDeleteConfirmScreen = () => <BackupDetailView dialog="delete" />
