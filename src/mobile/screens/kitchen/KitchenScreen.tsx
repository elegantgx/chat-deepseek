import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  AaMark,
  ActionRow,
  ArchiveIcon,
  AssistantMessage,
  AttachmentRow,
  AuthTitle,
  Avatar,
  BackIcon,
  BatteryIcon,
  Badge,
  Blocking,
  Button,
  ButtonRow,
  CameraIcon,
  Card,
  CardStack,
  ChatIcon,
  ChatNotice,
  ChatTopBar,
  CheckIcon,
  ChevronRightIcon,
  ChoiceDialog,
  ClipIcon,
  CloseIcon,
  CodeBlock,
  Composer,
  DataIcon,
  Dialog,
  DocIcon,
  Drawer,
  DrawerAccount,
  DrawerBody,
  DrawerSearch,
  DrawerSection,
  Empty,
  ExportIcon,
  FileIcon,
  FormError,
  FormNote,
  GlobeFilledIcon,
  GlobeIcon,
  IconButton,
  ImportIcon,
  InfoIcon,
  KeyIcon,
  KvList,
  KvRow,
  LinkStatus,
  ListRow,
  LogoutIcon,
  MenuIcon,
  MessageAction,
  MessageActions,
  MicIcon,
  MoreIcon,
  MuteIcon,
  NewChatIcon,
  Note,
  Notice,
  Page,
  PageBody,
  PageFooter,
  PasswordField,
  Pill,
  PlusIcon,
  PrepRow,
  ProgressBlock,
  Quote,
  Radio,
  RadioRow,
  RestoreIcon,
  RowStatus,
  SearchField,
  SectionTitle,
  SendIcon,
  ServerChip,
  ServerIcon,
  ShieldIcon,
  SignalIcon,
  SessionRow,
  Sheet,
  SheetAction,
  SlidersIcon,
  SortIcon,
  Spacer,
  Spinner,
  Stack,
  StatusActions,
  StatusHead,
  Steps,
  SunIcon,
  Switch,
  Textarea,
  TextField,
  ThinkIcon,
  ThinkingBlock,
  Toast,
  ToggleChip,
  TopBar,
  TrashIcon,
  UserBubble,
  UserCompactIcon,
  UserIcon,
  WarnIcon,
  SwapIcon,
  WifiIcon,
} from '../../ui/index.js'
import styles from './Kitchen.module.css'

/**
 * 组件自查页（临时）：把 `src/mobile/ui` 的每个组件按示意图里的典型用法摆一遍。
 * 不是产品页面，不接数据、不进 i18n；验证完可以由根 agent 直接删掉。
 * 分组顺序与视觉规范一致：基础 → 按钮 → 输入 → 导航 → 状态 → 聊天 → 图标。
 */
export const KitchenScreen = () => {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [choiceOpen, setChoiceOpen] = useState(false)
  const [blockingOpen, setBlockingOpen] = useState(false)
  const [toastOpen, setToastOpen] = useState(false)
  const [switchOn, setSwitchOn] = useState(true)
  const [radioValue, setRadioValue] = useState('system')
  const [search, setSearch] = useState('')
  const [formAddress, setFormAddress] = useState('https://chat.example.com')
  const [accountName, setAccountName] = useState('gx')
  const [password, setPassword] = useState('secret123')
  const [textarea, setTextarea] = useState('')
  const [thinkOn, setThinkOn] = useState(true)
  const [searchOn, setSearchOn] = useState(true)
  const [composerValue, setComposerValue] = useState('这版间距我调好了，截图在附件里')

  const iconSize = 22
  const icons: Array<[string, ReactNode]> = [
    ['back', <BackIcon key="back" size={iconSize} />],
    ['chevron', <ChevronRightIcon key="chevron" size={iconSize} />],
    ['menu', <MenuIcon key="menu" size={iconSize} />],
    ['close', <CloseIcon key="close" size={iconSize} />],
    ['check', <CheckIcon key="check" size={iconSize} />],
    ['plus', <PlusIcon key="plus" size={iconSize} />],
    ['more', <MoreIcon key="more" size={iconSize} />],
    ['sort', <SortIcon key="sort" size={iconSize} />],
    ['camera', <CameraIcon key="camera" size={iconSize} />],
    ['shield', <ShieldIcon key="shield" size={iconSize} />],
    ['signal', <SignalIcon key="signal" />],
    ['wifi', <WifiIcon key="wifi" />],
    ['battery', <BatteryIcon key="battery" />],
    ['mute', <MuteIcon key="mute" size={iconSize} />],
    ['user', <UserIcon key="user" size={iconSize} />],
    ['user-sm', <UserCompactIcon key="user-sm" size={iconSize} />],
    ['server', <ServerIcon key="server" size={iconSize} />],
    ['archive', <ArchiveIcon key="archive" size={iconSize} />],
    ['sliders', <SlidersIcon key="sliders" size={iconSize} />],
    ['swap', <SwapIcon key="swap" size={iconSize} />],
    ['globe', <GlobeIcon key="globe" size={iconSize} />],
    ['globe-fill', <GlobeFilledIcon key="globe-fill" size={iconSize} />],
    ['key', <KeyIcon key="key" size={iconSize} />],
    ['data', <DataIcon key="data" size={iconSize} />],
    ['doc', <DocIcon key="doc" size={iconSize} />],
    ['export', <ExportIcon key="export" size={iconSize} />],
    ['import', <ImportIcon key="import" size={iconSize} />],
    ['trash', <TrashIcon key="trash" size={iconSize} />],
    ['restore', <RestoreIcon key="restore" size={iconSize} />],
    ['logout', <LogoutIcon key="logout" size={iconSize} />],
    ['info', <InfoIcon key="info" size={iconSize} />],
    ['warn', <WarnIcon key="warn" size={iconSize} />],
    ['sun', <SunIcon key="sun" size={iconSize} />],
    ['chat', <ChatIcon key="chat" size={iconSize} />],
    ['file', <FileIcon key="file" size={iconSize} />],
    ['clip', <ClipIcon key="clip" size={iconSize} />],
    ['mic', <MicIcon key="mic" size={iconSize} />],
    ['send', <SendIcon key="send" size={iconSize} />],
    ['newchat', <NewChatIcon key="newchat" size={iconSize} />],
  ]

  return (
    <Page tone="group">
      <PageBody pad="settings">
        <div className={styles.intro}>
          <h1 className={styles.title}>组件自查 Kitchen</h1>
          <p className={styles.sub}>
            每个组件按示意里的典型用法摆一遍；对照 mockup.css 的类名与 docs/android/mockups/shots。
          </p>
          <p className={styles.meta}>390 × 844 · dpr 2 · 明暗两套都看</p>
        </div>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>基础 · Card / ListRow / Pill / Avatar</h2>
          <Stack gap={24}>
            <Card label="本机维护">
              <ListRow
                icon={<UserIcon />}
                title="本机账户"
                subtitle="所有者 · 共 2 个"
                showChevron
              />
              <ListRow icon={<ArchiveIcon />} title="本机备份" subtitle="3 个备份" showChevron />
              <ListRow
                icon={<SlidersIcon />}
                title="主机参数"
                subtitle="监听 · API 地址 · 目录"
                showChevron
              />
              <ListRow icon={<ImportIcon />} title="单行 / 右侧值" value="已保存" showChevron />
              <ListRow icon={<InfoIcon />} title="等宽值" value="0.1.5-official0.1.4" valueMono />
              <ListRow icon={<PlusIcon />} title="新建备份" value="需先停止服务" muted />
              <ListRow icon={<TrashIcon />} title="删除所有对话" danger />
              <ListRow icon={<AaMark />} title="字体大小" showChevron />
              <ListRow icon={<UserIcon />} title="角色单选（右侧圆点）" right={<Radio checked />} />
              <ListRow
                icon={<ExportIcon />}
                title="正在导出"
                right={<RowStatus tone="busy">正在导出</RowStatus>}
              />
              <ListRow
                icon={<ImportIcon />}
                title="导入历史对话"
                right={<RowStatus tone="error">导入失败</RowStatus>}
              />
            </Card>
            <Card standalone>
              <ListRow icon={<SwapIcon />} title="切换或添加服务器" showChevron />
            </Card>
          </Stack>

          <div className={styles.rowGap} />
          <Card padding="form">
            <div className={styles.stack12}>
              <div className={styles.pillRow}>
                <Pill tone="running" dot>
                  运行中
                </Pill>
                <Pill tone="stopped" dot>
                  已停止
                </Pill>
                <Pill tone="error" dot>
                  失败
                </Pill>
                <Pill tone="muted">内置后端</Pill>
                <Pill tone="brand">远程</Pill>
                <Badge>当前</Badge>
              </div>
              <div className={styles.pillRow}>
                <Avatar name="owner" />
                <Avatar name="gx" size="lg" badge={<CameraIcon size={14} />} />
                <span className={styles.note}>头像 36 / 72 + 角标</span>
              </div>
              <SectionTitle>分组标签 14/20</SectionTitle>
              <SectionTitle variant="compact">紧凑标签 13/18</SectionTitle>
            </div>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>按钮 · Button / IconButton</h2>
          <Card padding="form">
            <Stack gap={12}>
              <Stack gap={8}>
                <Button size="page" block>
                  主按钮 52 全宽胶囊
                </Button>
                <Button block disabled>
                  禁用主按钮（品牌色 45%）
                </Button>
                <Button block loading>
                  正在启动
                </Button>
              </Stack>
              <ButtonRow>
                <Button variant="secondary">重启</Button>
                <Button variant="danger">停止服务</Button>
              </ButtonRow>
              <ButtonRow>
                <Button>主按钮 48</Button>
                <Button variant="ghost">描边按钮</Button>
                <Button variant="quiet" size="card" block>
                  当前使用中
                </Button>
              </ButtonRow>
              <ButtonRow>
                <Button variant="text">文字按钮</Button>
                <Button variant="textDanger">危险文字</Button>
                <Button variant="secondary" disabled>
                  禁用次按钮
                </Button>
              </ButtonRow>
              <div className={styles.pillRow}>
                <Button size="sm" variant="secondary">
                  44 高次按钮
                </Button>
                <Button size="xs">40 高空态按钮</Button>
                <IconButton label="返回" variant="chip">
                  <BackIcon size={18} />
                </IconButton>
                <IconButton label="工具" size="sm">
                  <MicIcon size={16} />
                </IconButton>
                <IconButton label="发送" size="sm" variant="brand">
                  <SendIcon size={16} />
                </IconButton>
                <IconButton label="更多" size="md">
                  <MoreIcon size={18} />
                </IconButton>
              </div>
              <div className={styles.pillRow}>
                <IconButton label="返回禁用" variant="chip" disabled>
                  <BackIcon size={18} />
                </IconButton>
                <span className={styles.note}>IconButton：44 / 36 / 34，chip 底 / brand 底</span>
              </div>
            </Stack>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            输入 · TextField / Password / Search / Switch / Radio
          </h2>
          <Card padding="form">
            <TextField
              label="服务器地址"
              value={formAddress}
              onChange={(event) => setFormAddress(event.target.value)}
              hint="填完整地址，不要带 /api/v1"
              mono
            />
            <TextField
              label="监听地址"
              value="127.0.0.1:8091"
              readOnly
              hint="只在本机可访问，不能修改。"
            />
            <TextField
              label="地址错误"
              value="https://chat.example.com"
              onChange={(event) => setFormAddress(event.target.value)}
              hint="填完整地址，不要带 /api/v1"
              error="连不上这个地址，检查地址和网络。"
              mono
            />
          </Card>

          <div className={styles.rowGap} />
          <Card padding="form">
            <Stack gap={0}>
              <TextField
                variant="pill"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="用户名"
                hint="3–32 个字符，可用字母、数字、下划线。"
              />
              <PasswordField
                variant="pill"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码"
              />
              <TextField variant="pill" placeholder="API Key" mono />
              <TextField
                variant="login"
                placeholder="用户名"
                hint="登录字段间距 18（login 变体）"
              />
              <PasswordField variant="login" placeholder="密码" />
            </Stack>
          </Card>

          <div className={styles.rowGap} />
          <Card padding="form">
            <AuthTitle>登录</AuthTitle>
            <div className={styles.serverChipGap}>
              <ServerChip
                icon={<ServerIcon size={20} />}
                name="chat.example.com"
                statusLabel="已连接"
              />
            </div>
            <Stack gap={0}>
              <TextField variant="login" placeholder="用户名" />
              <PasswordField variant="login" placeholder="密码" invalid />
              <FormError>用户名或密码不对，再试一次。</FormError>
              <FormNote>用服务器上的账户登录，登录后直接进入聊天。</FormNote>
              <FormNote align="start" inset>
                修改后需要重启本机服务才生效。
              </FormNote>
              <Spacer size={40} />
              <Button size="page" block>
                登录并进入聊天
              </Button>
            </Stack>
          </Card>
          <div className={styles.rowGap} />
          <Card padding="form">
            <Stack gap={14}>
              <SearchField
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索对话内容..."
              />
              <div className={styles.line}>
                <span className={styles.lineLabel}>跟随系统</span>
                <Switch checked={switchOn} onChange={setSwitchOn} label="跟随系统" />
              </div>
              <div className={styles.stack12}>
                <RadioRow
                  checked={radioValue === 'system'}
                  onSelect={() => setRadioValue('system')}
                >
                  系统
                </RadioRow>
                <RadioRow checked={radioValue === 'light'} onSelect={() => setRadioValue('light')}>
                  浅色
                </RadioRow>
              </div>
              <Textarea
                label="多行文本域"
                value={textarea}
                onChange={(event) => setTextarea(event.target.value)}
                placeholder="示意外补的输入形态：沿用表单卡的填充底与 12 圆角。"
                hint="用于需要多行的表单；聊天输入框用 Composer。"
              />
            </Stack>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>导航 · TopBar / Drawer / Sheet / Dialog</h2>
          <Card className={styles.bleedCard}>
            <TopBar
              title="本机"
              onBack={() => undefined}
              right={
                <IconButton label="更多" size="md">
                  <MoreIcon size={18} />
                </IconButton>
              }
            />
            <TopBar title="启动中（返回禁用）" onBack={() => undefined} backDisabled />
            <ChatTopBar
              title="登录页间距调整"
              left={
                <IconButton label="打开会话抽屉" size="lg" onClick={() => setDrawerOpen(true)}>
                  <MenuIcon size={22} />
                </IconButton>
              }
              status={
                <LinkStatus tone="reconnecting" className={styles.headerStatus}>
                  重连中
                </LinkStatus>
              }
              right={
                <IconButton label="新建对话" size="lg">
                  <NewChatIcon size={20} />
                </IconButton>
              }
            />
          </Card>
          <div className={styles.rowGap} />
          <Card padding="form">
            <Stack gap={10}>
              <ButtonRow>
                <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
                  打开抽屉
                </Button>
                <Button variant="secondary" onClick={() => setSheetOpen(true)}>
                  打开弹层
                </Button>
              </ButtonRow>
              <ButtonRow>
                <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                  确认弹窗
                </Button>
                <Button variant="secondary" onClick={() => setChoiceOpen(true)}>
                  单选弹窗
                </Button>
              </ButtonRow>
              <ButtonRow>
                <Button variant="secondary" onClick={() => setBlockingOpen(true)}>
                  阻塞遮罩
                </Button>
                <Button variant="secondary" onClick={() => setToastOpen((value) => !value)}>
                  切换 Toast
                </Button>
              </ButtonRow>
            </Stack>
          </Card>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            状态 · Spinner / Progress / Notice / Empty / Steps
          </h2>
          <Card padding="form">
            <div className={styles.pillRow}>
              <Spinner size="sm" />
              <Spinner />
              <Spinner size="lg" />
              <span className={styles.note}>12 / 16 / 24</span>
            </div>
          </Card>
          <div className={styles.rowGap} />
          <Card padding="form">
            <ProgressBlock
              label="正在打包会话与附件…"
              value={62}
              sizeText="12.4 MB / 20.0 MB"
              remaining="约 8 秒"
            />
            <ProgressBlock label="正在启动服务…" />
            <Notice
              tone="info"
              icon={<FileIcon size={16} />}
              actions={[{ label: '取消', onClick: () => undefined }]}
            >
              <ProgressBlock tight label="登录页-间距.png" value={62} />
            </Notice>
          </Card>
          <div className={styles.rowGap} />
          <Card padding="form">
            <Stack gap={0}>
              <Notice
                tone="error"
                icon={<FileIcon size={16} />}
                actions={[
                  { label: '重试', onClick: () => undefined },
                  { label: '移除', onClick: () => undefined },
                ]}
              >
                <div>登录页-间距.png</div>
                <div>上传失败，重试或移除后再发送。</div>
              </Notice>
              <Notice tone="warn" actions={[{ label: '重试', onClick: () => undefined }]}>
                连不上远程服务器，检查网络后再试。
              </Notice>
              <Notice tone="info" icon={<Spinner size="sm" />}>
                连接中断了，正在自动重连。已收到的消息都还在。
              </Notice>
              <Notice tone="error" stacked actions={[{ label: '重试', onClick: () => undefined }]}>
                导入没有完成，原有对话没有被改动。重试会再用这个文件导入一次。
              </Notice>
              <ActionRow text="重试会再用这个文件导入一次。">
                <Button variant="text">重试</Button>
                <Button variant="text">保留原有对话</Button>
              </ActionRow>
            </Stack>
          </Card>
          <div className={styles.rowGap} />
          <Card>
            <Empty
              icon={<ArchiveIcon size={26} />}
              title="还没有备份"
              description="备份要手动创建：停止服务后新建一份，账户、会话、附件和设置都会打包进去。"
              action={<Button size="xs">新建备份</Button>}
            />
          </Card>
          <div className={styles.rowGap} />
          <Card padding="form">
            <div className={styles.pillRow}>
              <LinkStatus>已连接</LinkStatus>
              <LinkStatus tone="connecting">连接中</LinkStatus>
              <LinkStatus tone="reconnecting">重连中</LinkStatus>
              <LinkStatus tone="offline">已断开</LinkStatus>
              <LinkStatus spinner>正在导出</LinkStatus>
            </div>
          </Card>
          <div className={styles.rowGap} />
          <Steps
            items={[
              { label: '创建数据目录', state: 'done' },
              { label: '初始化数据库', state: 'current' },
              { label: '创建本机账户', state: 'pending' },
            ]}
          />
          <div className={styles.rowGap} />
          <Steps
            items={[
              { label: '创建数据目录', state: 'failed' },
              { label: '初始化数据库', state: 'pending' },
              { label: '创建本机账户', state: 'pending' },
            ]}
          />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>状态卡 · StatusHead + KvList + StatusActions</h2>
          <Card padding="status">
            <StatusHead tone="ok" pill={<Pill tone="muted">内置后端</Pill>}>
              运行中
            </StatusHead>
            <KvList>
              <KvRow label="监听" value="127.0.0.1:8091" />
              <KvRow label="版本" value="0.1.5-official0.1.4" />
              <KvRow label="数据目录" value="files/data" />
              <KvRow label="账户" value="owner" mono={false} />
            </KvList>
            <StatusActions>
              <Button variant="secondary">重启</Button>
              <Button variant="danger">停止服务</Button>
            </StatusActions>
          </Card>
          <div className={styles.rowGap} />
          <Card padding="status">
            <StatusHead tone="busy" pill={<Pill tone="muted">远程</Pill>}>
              连接中
            </StatusHead>
            <KvList>
              <KvRow label="地址" value="https://chat.example.com" />
              <KvRow label="账户" value="owner" mono={false} />
              <LinkStatus tone="connecting">正在获取服务器信息…</LinkStatus>
            </KvList>
            <StatusActions>
              <Button loading>正在连接</Button>
            </StatusActions>
          </Card>
          <div className={styles.rowGap} />
          <CardStack>
            <Card>
              <PrepRow>一台部署好 chat-deepseek 的服务器</PrepRow>
              <PrepRow>服务器上的用户名和密码</PrepRow>
            </Card>
            <Note>远程服务器需要自行部署和维护。</Note>
          </CardStack>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>聊天 · 气泡 / 思考 / 代码 / 引用 / 操作 / 输入区</h2>
          <div className={styles.chatFrame}>
            <ChatTopBar
              title="登录页间距调整"
              left={
                <IconButton label="打开会话抽屉" size="lg">
                  <MenuIcon size={22} />
                </IconButton>
              }
              right={
                <IconButton label="新建对话" size="lg">
                  <NewChatIcon size={20} />
                </IconButton>
              }
            />
            <ChatNotice>
              <Notice tone="warn" actions={[{ label: '重试', onClick: () => undefined }]}>
                连不上远程服务器，检查网络后再试。
              </Notice>
            </ChatNotice>
            <div className={styles.chatScroll}>
              <UserBubble>给文件夹加个监听，文件一变就重新编译</UserBubble>
              <AssistantMessage
                actions={
                  <MessageActions>
                    <MessageAction label="复制" icon={<DocIcon size={14} />}>
                      复制
                    </MessageAction>
                    <MessageAction label="重试" icon={<RestoreIcon size={14} />}>
                      重试
                    </MessageAction>
                  </MessageActions>
                }
              >
                <ThinkingBlock label="已深度思考（用时 12 秒）" defaultOpen>
                  先看输入框与按钮之间是不是 24，再对齐标题节奏。
                </ThinkingBlock>
                <Quote>引用：输入框下面留 24、按钮再往下 20 会松快些。</Quote>
                <p className={styles.chatText}>
                  可以用 fsnotify 监听目录事件，配合 200ms
                  防抖；保存时先取消上一次定时器，再触发构建。
                </p>
                <CodeBlock
                  language="go"
                  code={'watcher, _ := fsnotify.NewWatcher()\ndefer watcher.Close()'}
                  actions={<MessageAction label="复制代码" icon={<FileIcon size={14} />} />}
                />
              </AssistantMessage>
            </div>
            <Composer
              value={composerValue}
              onChange={setComposerValue}
              onSend={() => undefined}
              inputLabel="消息输入"
              sendLabel="发送"
              placeholder="发消息或按住说话"
              voiceLabel="语音输入"
              attachLabel="上传附件"
              onVoice={() => undefined}
              onAttach={() => undefined}
              toggles={
                <>
                  <ToggleChip on={thinkOn} onToggle={setThinkOn} icon={<ThinkIcon size={14} />}>
                    深度思考
                  </ToggleChip>
                  <ToggleChip
                    on={searchOn}
                    onToggle={setSearchOn}
                    icon={<GlobeFilledIcon size={14} />}
                  >
                    智能搜索
                  </ToggleChip>
                </>
              }
              attachments={
                <>
                  <AttachmentRow
                    name="登录页-间距.png"
                    percent={62}
                    note="12.4 MB / 20.0 MB"
                    actions={
                      <Button variant="text" size="inline">
                        取消
                      </Button>
                    }
                  />
                  <AttachmentRow
                    name="broken.zip"
                    error
                    note="上传失败，重试或移除后再发送。"
                    actions={
                      <>
                        <Button variant="text" size="inline">
                          重试
                        </Button>
                        <Button variant="text" size="inline">
                          移除
                        </Button>
                      </>
                    }
                  />
                </>
              }
              model="DeepSeek V3"
              hint="回答由 AI 生成，仅供参考"
              maxLength={2000}
            />
            <Composer
              value=""
              onChange={() => undefined}
              onSend={() => undefined}
              inputLabel="消息输入（禁用态）"
              sendLabel="发送"
              placeholder="已断开，暂时不能发送"
              voiceLabel="语音输入"
              attachLabel="上传附件"
              onVoice={() => undefined}
              onAttach={() => undefined}
              toggles={
                <ToggleChip on icon={<ThinkIcon size={14} />}>
                  深度思考
                </ToggleChip>
              }
              hint="输入区禁用态：整卡 --fill-2、描边收掉、动作 40%"
              disabled
            />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>图标 · mockup 全部 symbol</h2>
          <Card padding="form">
            <div className={styles.iconGrid}>
              {icons.map(([name, icon]) => (
                <div key={name} className={styles.iconCell}>
                  {icon}
                  <span className={styles.iconName}>{name}</span>
                </div>
              ))}
            </div>
            <p className={styles.note}>
              另有信号 / Wi-Fi / 电池 / 相机 / 静音 / 盾牌 / 地球实心等，状态栏与角标用。
            </p>
          </Card>
        </section>
      </PageBody>

      <PageFooter version="chat-deepseek 0.1.5-official0.1.4">
        内容由 AI 生成，请仔细甄别
      </PageFooter>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="会话历史">
        <DrawerSearch value={search} onChange={setSearch} placeholder="搜索对话内容..." />
        <DrawerBody>
          <DrawerSection title="今天" action={<SortIcon size={20} />} />
          <SessionRow
            title="用 Go 实现文件监听"
            active
            more={<MoreIcon size={18} />}
            onClick={() => undefined}
          />
          <SessionRow title="Android 端服务器切换方案" />
          <SessionRow title="备份恢复流程（未选中）" />
          <DrawerSection title="昨天" />
          <SessionRow title="登录页间距调整" />
        </DrawerBody>
        <DrawerAccount avatar={<Avatar name="owner" />} name="owner" />
      </Drawer>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="对话操作">
        <SheetAction>重命名</SheetAction>
        <SheetAction>置顶</SheetAction>
        <SheetAction danger>删除</SheetAction>
      </Sheet>

      <Dialog
        open={dialogOpen}
        title="删除所有对话？"
        body="删除后无法找回，服务器上的附件和草稿也会一起删除。"
        cancelLabel="取消"
        confirmLabel="删除"
        danger
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => setDialogOpen(false)}
      />

      <ChoiceDialog
        open={choiceOpen}
        title="外观"
        options={[
          { value: 'system', label: '系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ]}
        value={radioValue}
        onSelect={setRadioValue}
        confirmLabel="确认"
        onConfirm={() => setChoiceOpen(false)}
        onCancel={() => setChoiceOpen(false)}
      />

      {blockingOpen ? (
        <Blocking title="正在恢复备份，请勿退出" note="恢复完成前不能使用。">
          <ProgressBlock />
        </Blocking>
      ) : null}

      {toastOpen ? <Toast message="备份已创建" /> : null}
    </Page>
  )
}
