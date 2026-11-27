/**
 * 本机服务器组（01/02/03/04/05/08/09/10/26）的文案。
 *
 * 并行开发期先放这里，收尾时由根 agent 机械合并进 `src/i18n/{zh,en}.ts`（见 screens/strings.ts）。
 * 带 `{…}` 的是模板：屏自己用 `formatTemplate` 填，避免把数字拼进 key。
 * 写法遵循 visual §6：短值不加句号，独立句子加句号。
 */
const zh = {
  // 通用
  internalBackend: '内置后端',
  listen: '监听',
  version: '版本',
  dataDir: '数据目录',
  switchServer: '切换或添加服务器',
  reading: '读取中…',
  actionFailed: '操作没有完成，再试一次。',

  // 01 首次启动
  chooseServer: '选择服务器',

  // 02 切换或添加服务器
  pickerTitle: '服务器',
  localName: '本机',
  remoteName: '远程',
  current: '当前',
  currentInUse: '当前使用中',
  connectRemote: '连接远程',
  useLocal: '使用本机',
  localDesc: 'App 自带后端，装好就能用，不对外提供访问',
  remoteDesc: '填地址登录，连你自己部署的服务器',
  offline: '无需网络',
  pickerNote: '远程服务器需要自行部署和维护。',

  // 本机状态
  localTitle: '本机',
  running: '运行中',
  stopped: '已停止',
  uninitialized: '未初始化',
  unknown: '状态未知',
  connected: '已连接',
  preparing: '准备中',
  setupDone: '初始化完成',
  setupFailed: '初始化失败',
  init: '初始化',
  initializing: '正在初始化',
  retry: '重试',
  startService: '启动服务',
  restart: '重启',
  stopService: '停止服务',
  started: '服务已启动。',
  restarted: '服务已重启。',

  // 初始化流程
  stepCreateDir: '创建数据目录',
  stepInitDb: '初始化数据库',
  stepCreateAccount: '创建本机账户',
  uninitNote: '初始化会创建本机账户，之后用它登录本机服务。',
  preparingNote: '初始化完成后就可以开始聊天。',
  readyNote: '三步都完成了，接下来启动服务就能聊天。',
  stoppedNote: '启动后就能登录本机服务聊天。',
  localNote: '本机服务仅在 {host} 监听，不对外提供访问。',
  failedReason: '数据目录写不进去，检查存储空间后重试。',

  // 本机维护
  maintenance: '本机维护',
  accounts: '本机账户',
  backups: '本机备份',
  host: '主机参数',
  hostSub: '监听 · API 地址 · 目录',
  accountSummary: '{role} · 共 {count} 个',
  roleOwner: '所有者',
  roleAdmin: '管理员',
  roleMember: '成员',
  backupCount: '{count} 个备份',
  noBackups: '还没有备份',

  // 26 主机参数
  hostTitle: '主机参数',
  listenLabel: '监听地址',
  listenHint: '只在本机可访问，不能修改。',
  apiLabel: 'API 地址',
  apiHint: '修改后需要重启本机服务才生效。',
  dataDirLabel: '数据目录',
  dataDirHint: '存放账户、会话和附件，不能在 App 内修改。',
  backupDirLabel: '备份目录',
  backupDirHint: '留空则备份到数据目录下。',
  save: '保存',
  saved: '已保存，重启服务后生效。',
  configLoadFailed: '读取主机参数失败，返回后再试。',
}

/** 与 zh 同 key；漏一个键就是类型错误，避免中英漂移 */
const en: { [K in keyof typeof zh]: string } = {
  internalBackend: 'Built-in backend',
  listen: 'Listening',
  version: 'Version',
  dataDir: 'Data folder',
  switchServer: 'Switch or add server',
  reading: 'Loading…',
  actionFailed: 'That did not work. Try again.',

  chooseServer: 'Choose server',

  pickerTitle: 'Servers',
  localName: 'This device',
  remoteName: 'Remote',
  current: 'Current',
  currentInUse: 'In use',
  connectRemote: 'Connect remote',
  useLocal: 'Use this device',
  localDesc: 'Built-in backend. Works out of the box and stays on this device.',
  remoteDesc: 'Enter an address to sign in to a server you deploy yourself.',
  offline: 'No network needed',
  pickerNote: 'You deploy and maintain remote servers yourself.',

  localTitle: 'This device',
  running: 'Running',
  stopped: 'Stopped',
  uninitialized: 'Not set up',
  unknown: 'Unknown',
  connected: 'Connected',
  preparing: 'Preparing',
  setupDone: 'Setup complete',
  setupFailed: 'Setup failed',
  init: 'Set up',
  initializing: 'Setting up',
  retry: 'Retry',
  startService: 'Start service',
  restart: 'Restart',
  stopService: 'Stop service',
  started: 'Service started.',
  restarted: 'Service restarted.',

  stepCreateDir: 'Create data folder',
  stepInitDb: 'Initialize database',
  stepCreateAccount: 'Create local account',
  uninitNote: 'Setup creates a local account for signing in to this server.',
  preparingNote: 'When setup finishes you can start chatting.',
  readyNote: 'All three steps are done. Start the service to chat.',
  stoppedNote: 'Start the service, then sign in to chat.',
  localNote: 'The local service listens only on {host}.',
  failedReason: 'Could not write the data folder. Check free storage and retry.',

  maintenance: 'Local maintenance',
  accounts: 'Local accounts',
  backups: 'Local backups',
  host: 'Host settings',
  hostSub: 'Listening · API address · Folders',
  accountSummary: '{role} · {count} total',
  roleOwner: 'Owner',
  roleAdmin: 'Admin',
  roleMember: 'Member',
  backupCount: '{count} backups',
  noBackups: 'No backups yet',

  hostTitle: 'Host settings',
  listenLabel: 'Listen address',
  listenHint: 'Reachable only on this device. Cannot be changed.',
  apiLabel: 'API address',
  apiHint: 'Restart the local service to apply.',
  dataDirLabel: 'Data folder',
  dataDirHint: 'Stores accounts, chats, and attachments. Cannot be changed in the app.',
  backupDirLabel: 'Backup folder',
  backupDirHint: 'Leave empty to store backups in the data folder.',
  save: 'Save',
  saved: 'Saved. Restart the service to apply.',
  configLoadFailed: 'Could not load host settings. Go back and try again.',
}

export const localStrings = { zh, en }
