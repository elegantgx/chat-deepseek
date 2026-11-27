import type { Session, SessionSummary } from '../../services/chat/types.js'

/**
 * 固定会话数据：聊天页、会话抽屉、版本切换、删除后列表都要有可截图的内容。
 *
 * 时间全部写死成 2026-11-27 / 2026-11-26 的毫秒 epoch（+08:00），不用 `Date.now()`：
 * 同一 query 多次请求的 JSON 必须逐字节一致，截图 diff 才不会抖。
 * 真实形状以 `internal/chat/chat.go` 的 `Summary` 与 `src/services/chat/types.ts` 为准。
 */

const epoch = {
  goCreated: 1795743600000,
  goUpdated: 1795746240000,
  androidCreated: 1795740600000,
  androidUpdated: 1795741500000,
  backupCreated: 1795695000000,
  backupUpdated: 1795700400000,
  goM1: 1795745880000,
  goA1: 1795745920000,
  goM2: 1795746000000,
  goA2: 1795746030000,
  goA3: 1795746120000,
  androidM1: 1795741080000,
  androidA1: 1795741500000,
  backupM1: 1795699920000,
  backupA1: 1795700400000,
} as const

export interface StoredSession {
  session: Session
  version: number
}

export interface ChatHistory {
  /** 顺序固定：新 → 旧，对应抽屉里的“今天 / 昨天” */
  summaries: SessionSummary[]
  sessions: Map<string, StoredSession>
}

/** 第一个会话：用一条分支 + 引用 + 代码块覆盖聊天渲染的主要形态 */
const GO_SESSION: Session = {
  id: 'chat-go-watch',
  title: '用 Go 实现文件监听',
  createdAt: epoch.goCreated,
  updatedAt: epoch.goUpdated,
  rootMessageId: 'go-m1',
  messages: [
    {
      id: 'go-m1',
      role: 'user',
      content: '给文件夹加个监听，文件一变就重新编译。',
      files: [],
      createdAt: epoch.goM1,
      parentId: null,
      selectedChildId: 'go-a1',
    },
    {
      id: 'go-a1',
      role: 'assistant',
      createdAt: epoch.goA1,
      parentId: 'go-m1',
      selectedChildId: 'go-m2',
      model: 'deepseek-v4-pro',
      thinking: true,
      search: true,
      prefix: true,
      status: 'done',
      blocks: [
        {
          type: 'thinking',
          thinking:
            '先确认监听范围：只看源码目录，忽略构建产物和隐藏文件；用防抖合并短时间内的多次写入。',
          signature: 'scenario-signature-go-1',
          startedAt: epoch.goA1 - 1000,
          endedAt: epoch.goA1,
        },
        {
          type: 'text',
          text: '可以用 `fsnotify` 监听目录事件，配合 200ms 防抖：保存时先取消上一次定时器，再触发构建。\n\n```go\nwatcher, err := fsnotify.NewWatcher()\nif err != nil {\n\treturn err\n}\ndefer watcher.Close()\n\nif err := watcher.Add("src"); err != nil {\n\treturn err\n}\n```\n\n完整实现还要过滤 `*.tmp` 和 `.git` 目录，并在退出时关闭 watcher。',
        },
        {
          type: 'text',
          text: '更多细节可参考 fsnotify 的官方示例。',
          citations: [
            {
              type: 'web_search_result_location',
              url: 'https://github.com/fsnotify/fsnotify',
              title: 'fsnotify/fsnotify',
              cited_text: '更多细节可参考 fsnotify 的官方示例。',
              encrypted_index: '',
            },
          ],
        },
      ],
      stopReason: 'end_turn',
      usage: {
        input_tokens: 1280,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 386,
      },
    },
    {
      id: 'go-m2',
      role: 'user',
      content: '再改成只在保存时触发，并对比一下这两个方案。',
      files: [],
      createdAt: epoch.goM2,
      parentId: 'go-a1',
      // 分支点：go-a2 与 go-a3 是同一 parent 下的两个回答，选第二个
      selectedChildId: 'go-a3',
    },
    {
      id: 'go-a2',
      role: 'assistant',
      createdAt: epoch.goA2,
      parentId: 'go-m2',
      model: 'deepseek-flash',
      thinking: false,
      search: false,
      prefix: true,
      status: 'done',
      blocks: [
        {
          type: 'text',
          text: '更轻量的做法是只在编辑器保存事件里触发一次构建，不监听目录。',
        },
      ],
      stopReason: 'end_turn',
    },
    {
      id: 'go-a3',
      role: 'assistant',
      createdAt: epoch.goA3,
      parentId: 'go-m2',
      model: 'deepseek-v4-pro',
      thinking: true,
      search: false,
      prefix: true,
      status: 'done',
      blocks: [
        {
          type: 'thinking',
          thinking: '两个方案都保留：监听目录能覆盖编辑器之外的改动，保存触发更适合快速迭代。',
          signature: 'scenario-signature-go-2',
          startedAt: epoch.goA3 - 1200,
          endedAt: epoch.goA3,
        },
        {
          type: 'text',
          text: '## 对比\n\n| 方案 | 覆盖范围 | 实现成本 |\n| --- | --- | --- |\n| 目录监听 | 编辑器、构建脚本、`git checkout` 都会触发 | 需要防抖与忽略规则 |\n| 保存触发 | 只覆盖编辑器内保存 | 只需一次 `onSave` 回调 |\n\n如果只在编辑器里改代码，保存触发就够了；否则保留目录监听。\n\n> 注意：监听整个仓库时要把 `node_modules` 排除掉。',
        },
        {
          type: 'text',
          text: '在 Go 里可以把两者合起来：目录监听负责兜底，保存事件负责立即响应。',
        },
      ],
      stopReason: 'end_turn',
      usage: {
        input_tokens: 1640,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 512,
      },
    },
  ],
}

/**
 * 抽屉截图专用：把第一条会话换成示意 `chat-drawer` 背后那张装饰页的内容。
 *
 * 抽屉打开时聊天页被推到右边，只露出左侧一条；那条里能看到标题、气泡和输入框的起始位置。
 * 默认的 GO_SESSION 带思考块、代码块和分支，露出来的那一条与示意对不上，所以单独做一个
 * 精简版本，而不是为了截图把正常会话阉割掉。两条文案与示意逐字一致（含缺少的句号）。
 */
const DRAWER_GO_SESSION: Session = {
  id: 'chat-go-watch',
  title: '用 Go 实现文件监听',
  createdAt: epoch.goCreated,
  updatedAt: epoch.goUpdated,
  rootMessageId: 'go-m1',
  messages: [
    {
      id: 'go-m1',
      role: 'user',
      content: '给文件夹加个监听，文件一变就重新编译',
      files: [],
      createdAt: epoch.goM1,
      parentId: null,
      selectedChildId: 'go-a1',
    },
    {
      id: 'go-a1',
      role: 'assistant',
      createdAt: epoch.goA1,
      parentId: 'go-m1',
      model: 'deepseek-v4-pro',
      thinking: false,
      search: false,
      prefix: true,
      status: 'done',
      blocks: [
        {
          type: 'text',
          text: '可以用 fsnotify 监听目录事件，配合 200ms 防抖；保存时先取消上一次定时器，再触发构建。',
        },
      ],
      stopReason: 'end_turn',
      usage: {
        input_tokens: 128,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 48,
      },
    },
  ],
}

const ANDROID_SESSION: Session = {
  id: 'chat-android-switch',
  title: 'Android 端服务器切换方案',
  createdAt: epoch.androidCreated,
  updatedAt: epoch.androidUpdated,
  rootMessageId: 'android-m1',
  messages: [
    {
      id: 'android-m1',
      role: 'user',
      content: '切换服务器时，渲染层内存里的登录态怎么清？',
      files: [],
      createdAt: epoch.androidM1,
      parentId: null,
      selectedChildId: 'android-a1',
    },
    {
      id: 'android-a1',
      role: 'assistant',
      createdAt: epoch.androidA1,
      parentId: 'android-m1',
      model: 'deepseek-v4-pro',
      thinking: false,
      search: false,
      prefix: true,
      status: 'done',
      blocks: [
        {
          type: 'text',
          text: '切换时整页重载最干净：CSRF token 只存在内存里，Cookie 在壳的 CookieJar 里，两边一起清掉再重新加载 assets 即可。',
        },
      ],
      stopReason: 'end_turn',
    },
  ],
}

const BACKUP_SESSION: Session = {
  id: 'chat-backup-restore',
  title: '备份恢复流程',
  createdAt: epoch.backupCreated,
  updatedAt: epoch.backupUpdated,
  rootMessageId: 'backup-m1',
  messages: [
    {
      id: 'backup-m1',
      role: 'user',
      content: '恢复备份前为什么要先停止服务？',
      files: [],
      createdAt: epoch.backupM1,
      parentId: null,
      selectedChildId: 'backup-a1',
    },
    {
      id: 'backup-a1',
      role: 'assistant',
      createdAt: epoch.backupA1,
      parentId: 'backup-m1',
      model: 'deepseek-v4-pro',
      thinking: false,
      search: false,
      prefix: true,
      status: 'done',
      blocks: [
        {
          type: 'text',
          text: '因为恢复会覆盖 `chat.db` 与 `-wal` / `-shm`；服务还在写的时候换文件，会把未落盘的页写回旧库。所以先停服务，恢复后再自动重启。',
        },
      ],
      stopReason: 'end_turn',
    },
  ],
}

const summaryOf = (session: Session): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
})

/** 空历史：`chat-empty` 与其它场景保持原来的空列表行为 */
export const emptyChatHistory = (): ChatHistory => ({ summaries: [], sessions: new Map() })

/** 产出一份全新的历史；删除只改这份内存状态，刷新页面即复位 */
export const createChatHistory = (mode: 'rich' | 'drawer' = 'rich'): ChatHistory => {
  const sessions: StoredSession[] = [
    { session: mode === 'drawer' ? DRAWER_GO_SESSION : GO_SESSION, version: 7 },
    { session: ANDROID_SESSION, version: 3 },
    { session: BACKUP_SESSION, version: 2 },
  ]
  return {
    summaries: sessions.map(({ session }) => summaryOf(session)),
    sessions: new Map(sessions.map(({ session, version }) => [session.id, { session, version }])),
  }
}
