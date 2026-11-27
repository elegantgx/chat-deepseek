import { useStrings } from '../strings.js'

/**
 * 远程服务器组的文案。
 *
 * 并行开发期先留在这里，避免直接改 `src/i18n/{zh,en}.ts` 和其它屏组打架；
 * 集成时由根 agent 机械合并。zh 是 key 源头，en 用 `typeof zh` 约束，缺 key 会编译失败。
 */
const zh = {
  // 添加远程服务器（14 / 15）
  addTitle: '远程',
  addressLabel: '服务器地址',
  addressHint: '填完整地址，不要带 /api/v1',
  addressPlaceholder: 'https://chat.example.com',
  testConnection: '测试连接',
  prepare: '需要准备',
  prepareServer: '一台部署好 chat-deepseek 的服务器',
  prepareAccount: '服务器上的用户名和密码',
  errorNetwork: '连不上这个地址，检查地址和网络。',
  errorHttp: '服务器返回 HTTP {status}，确认地址是否正确。',
  errorProtocol: '这个地址不是 chat-deepseek 服务器。',
  errorHttps: '远程服务器必须使用 https。',
  errorInvalid: '地址格式不正确。',
  errorSwitch: '切换服务器失败，再试一次。',
  errorAdd: '添加服务器失败，再试一次。',
  // 证书失败不是「连不上」：没有忽略证书的开关，只能换地址或换证书
  errorTls: '证书不受信任，换地址或换证书后重试。',

  // 远程登录（16 / 17）
  loginTitle: '登录',
  // 服务端只回「凭据不对」，两个框一起标红，所以错误行只有这一句
  errorCredentials: '用户名或密码不对，再试一次。',
  errorEmptyCredentials: '填用户名和密码后再登录。',
  errorLoginNetwork: '连不上这台服务器，检查网络后重试。',
  errorLoginUnknown: '登录失败，再试一次。',
  usernamePlaceholder: '用户名',
  passwordPlaceholder: '密码',
  connected: '已连接',
  loginSubmit: '登录并进入聊天',
  loginNote: '用服务器上的账户登录，登录后直接进入聊天。',
  serverMissing: '找不到这台服务器，请重新添加。',
  addServer: '添加远程服务器',

  // 远程详情（18 / 19）与连接中、证书失败两个内部状态
  detailTitle: '远程',
  pillRemote: '远程',
  address: '地址',
  version: '版本',
  account: '账户',
  accountUnknown: '未登录',
  offline: '连接断开',
  connecting: '连接中',
  cert: '证书不受信任',
  reconnect: '重连',
  connectingButton: '正在连接',
  connectingInfo: '正在获取服务器信息…',
  offlineReason: '连不上这台服务器，检查网络后重试。',
  httpReason: '服务器返回 HTTP {status}，检查地址后重试。',
  protocolReason: '这个地址不是 chat-deepseek 服务器。',
  certReason: '证书不受信任，换地址或换证书后重试。',
  switchServer: '切换或添加服务器',
  detailFooter: '远程服务器需要自行部署和维护。',
  noRemoteServer: '还没有远程服务器。',
}

const en: typeof zh = {
  addTitle: 'Remote',
  addressLabel: 'Server address',
  addressHint: 'Use the full address, without /api/v1',
  addressPlaceholder: 'https://chat.example.com',
  testConnection: 'Test connection',
  prepare: 'What you need',
  prepareServer: 'A server with chat-deepseek deployed',
  prepareAccount: 'The username and password for that server',
  errorNetwork: "Can't reach this address. Check the address and network.",
  errorHttp: 'The server returned HTTP {status}. Check the address.',
  errorProtocol: 'This address is not a chat-deepseek server.',
  errorHttps: 'Remote servers must use https.',
  errorInvalid: 'Invalid server address.',
  errorSwitch: 'Could not switch servers. Try again.',
  errorAdd: 'Could not add the server. Try again.',
  errorTls: 'Certificate not trusted. Change the address or the certificate and try again.',

  loginTitle: 'Sign in',
  errorCredentials: 'Wrong username or password. Try again.',
  errorEmptyCredentials: 'Enter your username and password first.',
  errorLoginNetwork: "Can't reach this server. Check the network and try again.",
  errorLoginUnknown: 'Sign-in failed. Try again.',
  usernamePlaceholder: 'Username',
  passwordPlaceholder: 'Password',
  connected: 'Connected',
  loginSubmit: 'Sign in and start chatting',
  loginNote: "Use your account on the server. You'll go straight to chat after signing in.",
  serverMissing: 'Server not found. Add it again.',
  addServer: 'Add remote server',

  detailTitle: 'Remote',
  pillRemote: 'Remote',
  address: 'Address',
  version: 'Version',
  account: 'Account',
  accountUnknown: 'Not signed in',
  offline: 'Connection lost',
  connecting: 'Connecting',
  cert: 'Certificate error',
  reconnect: 'Reconnect',
  connectingButton: 'Connecting',
  connectingInfo: 'Getting server information…',
  offlineReason: "Can't reach this server. Check the network and try again.",
  httpReason: 'The server returned HTTP {status}. Check the address and try again.',
  protocolReason: 'This address is not a chat-deepseek server.',
  certReason: 'Certificate not trusted. Change the address or the certificate and try again.',
  switchServer: 'Switch or add server',
  detailFooter: 'Remote servers are deployed and maintained by you.',
  noRemoteServer: 'No remote server yet.',
}

const REMOTE_STRINGS = { zh, en }

export type RemoteStrings = typeof zh

export const useRemoteStrings = (): RemoteStrings => useStrings(REMOTE_STRINGS)
