import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArchiveIcon,
  Badge,
  BrandMark,
  Button,
  Card,
  CardFooter,
  CardHeader,
  DatabaseIcon,
  Dialog,
  EmptyState,
  Field,
  LogPane,
  Paper,
  Segmented,
  ServerIcon,
  Sidebar,
  SidebarBrand,
  SidebarItem,
  SlidersIcon,
  StatusPill,
  Table,
  TextButton,
  Toast,
  Toggle,
  UsersIcon,
  type LogLine,
  type TableColumn,
} from '../ui'
import styles from './gallery.module.css'

/**
 * 组件总览：默认视图对齐 07-components.png；
 * 第二个视图把 Paper / Card / Table / LogPane 放进真实页面骨架，两套主题都能看。
 */

type Theme = 'light' | 'dark'
type View = 'components' | 'density'

function parseHash(): { theme: Theme; view: View } {
  const parts = window.location.hash.replace(/^#/, '').split('-')
  return {
    theme: parts.includes('dark') ? 'dark' : 'light',
    view: parts.includes('density') ? 'density' : 'components',
  }
}

const INITIAL_STATE = parseHash()

const NAV_ITEMS = [
  { key: 'service', label: '服务', icon: <ServerIcon /> },
  { key: 'accounts', label: '账户', icon: <UsersIcon /> },
  { key: 'backup', label: '备份', icon: <ArchiveIcon /> },
  { key: 'settings', label: '设置', icon: <SlidersIcon /> },
] as const

const CONNECTION_OPTIONS = [
  { value: 'local', label: '本地' },
  { value: 'ssh', label: 'SSH', disabled: true },
] as const

const APPEARANCE_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const

const BACKUP_ROWS = [
  { name: 'chat-deepseek-20261126-021400.zip', time: '2026-11-26 02:14', size: '48.2 MB' },
  { name: 'chat-deepseek-20261125-021400.zip', time: '2026-11-25 02:14', size: '47.9 MB' },
  { name: 'chat-deepseek-20261124-021400.zip', time: '2026-11-24 02:14', size: '47.1 MB' },
  { name: 'chat-deepseek-20261123-021400.zip', time: '2026-11-23 02:14', size: '46.8 MB' },
]

const LOG_LINES: LogLine[] = [
  { id: 'l1', time: '22:14:03', level: 'info', message: 'serve listening on 127.0.0.1:8091' },
  {
    id: 'l2',
    time: '22:14:03',
    level: 'info',
    message: 'database opened: data/chat.db (journal=wal)',
  },
  {
    id: 'l3',
    time: '22:14:04',
    level: 'info',
    message: 'webui embedded build 0.1.4-official0.1.4',
  },
  { id: 'l4', time: '22:14:11', level: 'info', message: 'login ok user=gx ip=127.0.0.1' },
  { id: 'l5', time: '22:14:12', level: 'info', message: 'session 9f3c…31 created (branch main)' },
  { id: 'l6', time: '22:15:02', level: 'info', message: 'settings updated: theme=system lang=zh' },
  { id: 'l7', time: '22:15:40', level: 'info', message: 'session 9f3c…31 saved version=42 (18ms)' },
  { id: 'l8', time: '22:15:41', level: 'info', message: 'stream proxy deepseek-chat 128 tok/s' },
  { id: 'l9', time: '22:16:02', level: 'warn', message: 'backup skipped: wal file present' },
  { id: 'l10', time: '22:16:33', level: 'error', message: 'restore failed: service is running' },
  { id: 'l11', time: '22:16:41', level: 'info', message: 'GET /api/service 200 (3ms)' },
  { id: 'l12', time: '22:16:44', level: 'info', message: 'GET /api/sessions 200 (7ms)' },
  { id: 'l13', time: '22:16:52', level: 'info', message: 'POST /api/chat/stream 200 (1.2s)' },
  {
    id: 'l14',
    time: '22:16:59',
    level: 'info',
    message: 'session 9f3c…31 saved version=43 (12ms)',
  },
  { id: 'l15', time: '22:17:04', level: 'info', message: 'GET /api/settings 200 (2ms)' },
]

interface AccountRow {
  id: string
  user: string
  initials: string
  role: string
  created: string
}

const ACCOUNT_ROWS: AccountRow[] = [
  { id: 'gx', user: 'gx', initials: 'GX', role: '管理员', created: '2026-11-02 09:14' },
  { id: 'chen', user: 'chen', initials: 'CH', role: '成员', created: '2026-11-20 14:30' },
  { id: 'lin', user: 'lin', initials: 'LI', role: '成员', created: '2026-11-25 20:07' },
]

const MINI_ROWS: ReadonlyArray<{ user: string; role: string }> = [
  { user: 'gx', role: '管理员' },
  { user: 'chen', role: '成员' },
]

const MINI_COLUMNS: ReadonlyArray<TableColumn<{ user: string; role: string }>> = [
  { key: 'user', header: '用户名', render: (row) => row.user },
  { key: 'role', header: '角色', render: (row) => row.role },
]

interface BoardButtonProps {
  active?: boolean
  onClick: () => void
  children: ReactNode
}

/** 板面右上角的中性文字按钮：01/07 里的 a 链接都是 11px 灰字，不带强调色 */
function BoardButton({ active, onClick, children }: BoardButtonProps) {
  return (
    <button
      type="button"
      className={active ? `${styles.boardAction} ${styles.boardActionOn}` : styles.boardAction}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

interface SpecCardProps {
  title: string
  note: string
  span: 3 | 4 | 6
  children: ReactNode
}

function SpecCard({ title, note, span, children }: SpecCardProps) {
  const spanClass = span === 3 ? styles.span3 : span === 4 ? styles.span4 : styles.span6
  return (
    <section className={`${styles.specCard} ${spanClass}`}>
      <div className={styles.specHead}>
        <span className={styles.specTitle}>{title}</span>
        <span className={styles.specNote}>{note}</span>
      </div>
      {children}
    </section>
  )
}

export function GalleryApp() {
  const [theme, setTheme] = useState<Theme>(INITIAL_STATE.theme)
  const [view, setView] = useState<View>(INITIAL_STATE.view)
  const [activeNav, setActiveNav] = useState<string>(
    INITIAL_STATE.view === 'density' ? 'accounts' : 'service'
  )
  const [toggleOn, setToggleOn] = useState(true)
  const [toggleOff, setToggleOff] = useState(false)
  const [connection, setConnection] = useState<'local' | 'ssh'>('local')
  const [appearance, setAppearance] = useState<'light' | 'dark' | 'system'>('system')
  const [endpoint, setEndpoint] = useState('127.0.0.1:8091')
  const [apiHost, setApiHost] = useState('api.deepseek.com')
  const [badPort, setBadPort] = useState('127.0.0.1:99999')
  const [logs, setLogs] = useState<LogLine[]>(LOG_LINES)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const writeHash = (nextTheme: Theme, nextView: View) => {
    const parts = [nextTheme, nextView === 'density' ? 'density' : ''].filter(Boolean)
    window.history.replaceState(null, '', `#${parts.join('-')}`)
  }

  const selectTheme = (next: Theme) => {
    setTheme(next)
    writeHash(next, view)
  }

  const selectView = (next: View) => {
    setView(next)
    writeHash(theme, next)
  }

  const accountColumns: ReadonlyArray<TableColumn<AccountRow>> = [
    {
      key: 'user',
      header: '用户名',
      width: 220,
      render: (row) => (
        <span className={styles.cellUser}>
          <span className={`${styles.avatar} ${styles.avatarSm}`}>{row.initials}</span>
          {row.user}
        </span>
      ),
    },
    { key: 'role', header: '角色', width: 160, render: (row) => row.role },
    {
      key: 'created',
      header: '创建时间',
      render: (row) => <span className={styles.created}>{row.created}</span>,
    },
  ]

  const themeLinks = (
    <>
      <BoardButton active={theme === 'light'} onClick={() => selectTheme('light')}>
        浅色
      </BoardButton>
      <BoardButton active={theme === 'dark'} onClick={() => selectTheme('dark')}>
        深色
      </BoardButton>
    </>
  )

  return (
    <div className={styles.root}>
      <div className={styles.material} aria-hidden="true" />
      <div className={styles.noise} aria-hidden="true" />
      <div className={styles.window}>
        <Sidebar
          brand={<SidebarBrand name="chat-deepseek" subtitle="管理控制台" icon={<BrandMark />} />}
          footer={
            <>
              <div className={styles.conn}>
                <span className={styles.dotOk} aria-hidden="true" />
                本地 · 运行中
              </div>
              <div className={styles.version}>0.1.4-official0.1.4</div>
            </>
          }
        >
          {NAV_ITEMS.map((item) => (
            <SidebarItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={activeNav === item.key}
              onClick={() => setActiveNav(item.key)}
            />
          ))}
        </Sidebar>

        {view === 'components' ? (
          <main className={styles.board}>
            <header className={styles.boardHead}>
              <h1 className={styles.boardTitle}>组件总览</h1>
              <div className={styles.boardLinks}>
                <span className={styles.boardLink}>服务</span>
                <span className={styles.boardLink}>账户</span>
                <span className={styles.boardLink}>备份</span>
                <span className={styles.boardLink}>设置</span>
                <span className={styles.boardDivider} aria-hidden="true" />
                <BoardButton onClick={() => selectView('density')}>纸面 · 日志</BoardButton>
                <span className={styles.themeLinks}>{themeLinks}</span>
              </div>
            </header>

            <div className={styles.specGrid}>
              <SpecCard title="按钮" note="高 32 / 圆角 8" span={4}>
                <div className={styles.specStack}>
                  <div className={styles.specItem}>
                    <Button className={styles.fixedButton}>保存更改</Button>
                    <span className={styles.specCapInline}>主 · hover +4% / active −6%</span>
                  </div>
                  <div className={styles.specItem}>
                    <Button tone="secondary" className={styles.fixedButton}>
                      取消
                    </Button>
                    <span className={styles.specCapInline}>次 · 透明底 + 内描边</span>
                  </div>
                  <div className={styles.specItem}>
                    <Button tone="danger" className={styles.fixedButton}>
                      停止服务
                    </Button>
                    <span className={styles.specCapInline}>危险 · hover 6% 底</span>
                  </div>
                  <div className={styles.specItem}>
                    <Button disabled className={styles.fixedButton}>
                      不可用
                    </Button>
                    <span className={styles.specCapInline}>禁用 · 去色，不画描边</span>
                  </div>
                </div>
              </SpecCard>

              <SpecCard title="输入框" note="填充式 · 高 32" span={4}>
                <div className={styles.inputGrid}>
                  <Field
                    label="默认 · 内描边 8%"
                    value={endpoint}
                    onChange={setEndpoint}
                    fullWidth
                  />
                  <Field
                    label="聚焦 · 3px 蓝晕"
                    value={apiHost}
                    onChange={setApiHost}
                    fullWidth
                    autoFocus
                  />
                  <Field
                    label="错误 · 红边 + 红晕"
                    value={badPort}
                    onChange={setBadPort}
                    fullWidth
                    invalid
                  />
                  <Field label="只读 · 下沉底" value="~/chat-deepseek" readOnly mono fullWidth />
                </div>
              </SpecCard>

              <SpecCard title="开关 · 分段" note="全圆角 / 8" span={4}>
                <div className={styles.specStack}>
                  <div className={styles.specItem}>
                    <Toggle checked={toggleOn} onChange={setToggleOn} label="开机自启" />
                    <span className={styles.specCapInline}>开 · 轨道用强调色</span>
                  </div>
                  <div className={styles.specItem}>
                    <Toggle checked={toggleOff} onChange={setToggleOff} label="开机自启（关）" />
                    <span className={styles.specCapInline}>关 · 中性轨道，无描边</span>
                  </div>
                  <div className={styles.specItem}>
                    <Segmented
                      options={CONNECTION_OPTIONS}
                      value={connection}
                      onChange={setConnection}
                      label="连接方式"
                      width={148}
                    />
                    <span className={styles.specCapInline}>禁用段置灰</span>
                  </div>
                  <div className={styles.specItem}>
                    <Segmented
                      options={APPEARANCE_OPTIONS}
                      value={appearance}
                      onChange={setAppearance}
                      label="主题"
                      width={204}
                    />
                  </div>
                </div>
              </SpecCard>

              <SpecCard title="状态胶囊" note="高 22" span={3}>
                <div className={styles.specStack}>
                  <StatusPill status="running" />
                  <StatusPill status="stopped" />
                  <StatusPill status="error" />
                </div>
                <div className={styles.badgeRow}>
                  <Badge>管理员</Badge>
                  <span className={styles.specCapInline}>徽章 · 强调色 12% 底</span>
                </div>
              </SpecCard>

              <SpecCard title="卡片" note="header / footer 收口" span={3}>
                <Card clip>
                  <CardHeader title="当前账户" actions={<Badge>管理员</Badge>} />
                  <div className={styles.accountRows}>
                    <div className={styles.accountRow}>
                      <span className={styles.avatar}>GX</span>
                      <span className={styles.accountMain}>
                        <span className={styles.accountName}>gx</span>
                        <span className={styles.accountSub}>当前登录</span>
                      </span>
                    </div>
                  </div>
                  <CardFooter>
                    共 1 个账户
                    <TextButton tone="accent" className={styles.footLink}>
                      管理
                    </TextButton>
                  </CardFooter>
                </Card>
              </SpecCard>

              <SpecCard title="表格行" note="高 44" span={3}>
                <div className={styles.tableWrap}>
                  <Table
                    columns={MINI_COLUMNS}
                    rows={MINI_ROWS}
                    rowKey={(row) => row.user}
                    caption="账户示例"
                  />
                </div>
                <p className={styles.specCap}>无表头底、1px 行分隔</p>
              </SpecCard>

              <SpecCard title="侧栏选中态" note="不透明底对照" span={3}>
                <div className={styles.navSpec}>
                  <SidebarItem icon={<UsersIcon />} label="账户" />
                  <div className={styles.hoverSlot}>
                    <SidebarItem icon={<ArchiveIcon />} label="备份 · hover" />
                  </div>
                  <SidebarItem icon={<ServerIcon />} label="服务 · 选中" active />
                </div>
                <p className={styles.specCap}>只变颜色 + 胶囊底</p>
              </SpecCard>

              <SpecCard title="对话框" note="玻璃层 · 圆角 14 · 遮罩 16%" span={6}>
                <div className={styles.floatDemo}>
                  <div className={styles.floatBg}>
                    {BACKUP_ROWS.map((row) => (
                      <div key={row.name} className={styles.miniListRow}>
                        <span>{row.name}</span>
                        <span className={styles.mono}>{row.time}</span>
                        <span className={styles.mono}>{row.size}</span>
                      </div>
                    ))}
                  </div>
                  <Dialog
                    open
                    variant="contained"
                    size="sm"
                    title="删除这份备份？"
                    description="chat-deepseek-20261123-021400.zip 将被永久删除，无法恢复。"
                    actions={
                      <>
                        <Button size="sm" tone="secondary">
                          取消
                        </Button>
                        <Button size="sm" tone="dangerSolid">
                          删除
                        </Button>
                      </>
                    }
                  />
                </div>
                <p className={styles.specCap}>只模糊浮层背后，不把玻璃铺到正文上</p>
              </SpecCard>

              <SpecCard title="Toast" note="玻璃层 · 圆角 12" span={3}>
                <div className={styles.specStack}>
                  <Toast tone="success">备份已写入</Toast>
                  <Toast tone="error">恢复失败：服务正在运行</Toast>
                </div>
                <p className={styles.specCap}>3s 后自动消失；不阻塞操作</p>
              </SpecCard>

              <SpecCard title="空状态" note="内容层" span={3}>
                <EmptyState
                  compact
                  icon={<DatabaseIcon />}
                  title="还没有备份"
                  description="停止服务后点「立即备份」"
                />
                <p className={styles.specCapCenter}>图标 40 圆形底 + 一句操作指引</p>
              </SpecCard>
            </div>
          </main>
        ) : (
          <main className={styles.boardFlush}>
            <Paper className={styles.densityPaper}>
              <div className={styles.pageHead}>
                <h2 className={styles.pageTitle}>账户与日志</h2>
                <div className={styles.pageActions}>
                  <BoardButton onClick={() => selectView('components')}>组件总览</BoardButton>
                  <span className={styles.themeLinks}>{themeLinks}</span>
                  <Button size="sm">添加用户</Button>
                </div>
              </div>
              <div className={styles.pageBody}>
                <Card clip>
                  <CardHeader title="账户" />
                  <Table
                    columns={accountColumns}
                    rows={ACCOUNT_ROWS}
                    rowKey={(row) => row.id}
                    caption="账户列表"
                    actions={{
                      width: 168,
                      render: (row) => (
                        <>
                          <TextButton tone="accent">改密码</TextButton>
                          <TextButton tone="danger" aria-label={`删除 ${row.user}`}>
                            删除
                          </TextButton>
                        </>
                      ),
                    }}
                  />
                  <CardFooter>共 3 个账户</CardFooter>
                </Card>
                <LogPane
                  lines={logs}
                  count={1284}
                  onClear={() => setLogs([])}
                  footerAction={{ label: '查看全部日志' }}
                />
              </div>
            </Paper>
          </main>
        )}
      </div>
    </div>
  )
}
