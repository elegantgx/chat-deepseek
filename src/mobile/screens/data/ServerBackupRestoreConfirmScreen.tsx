import { BackupDetailView } from './BackupDetailView.js'

/** 恢复确认（#24）：说明替换与不可撤销，确认后由详情页执行“恢复并重启” */
export const ServerBackupRestoreConfirmScreen = () => <BackupDetailView dialog="restore" />
