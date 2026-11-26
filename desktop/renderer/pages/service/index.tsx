import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  PageBody,
  PageHead,
  normalizeHostError,
  useHost,
  useHostEvent,
  useRequest,
} from '../../app'
import type { HostError } from '../../app'
import type { ServiceLogEvent, ServiceLogsResult, SystemStatus } from '../../app/ipc-types'
import {
  AlertTriangleIcon,
  Button,
  Card,
  CardFooter,
  CardHeader,
  EmptyState,
  LogPane,
  PowerIcon,
  RefreshIcon,
  Toast,
} from '../../ui'
import type { LogLine } from '../../ui'
import { clockTime, parseLogLine } from './logs'
import styles from './service.module.css'

type ServiceAction = 'start' | 'stop' | 'restart'

/** `service.*` 底层只有 systemd 用户级实现，见 docs/ipc.md §9 */
const START_MODE = 'systemd 用户级'

/** 日志快照默认取最近 200 行；界面不做轮询，增量靠事件 */
const LOG_TAIL = 200

/** 「查看全部日志」一次取到后端上限；再多的部分由后端按 5000 截断 */
const LOG_TAIL_FULL = 5000

/** Toast 不阻塞操作，4 秒后自行消失（组件本身不带定时器） */
const TOAST_MS = 4000

/** 启动返回 starting 后，TCP 探测没通过是常态；按契约轮询到 running/stopped */
const START_POLL_MS = 700
const START_POLL_TIMEOUT_MS = 20_000

/** 事件只追加；快照最多 5000 行，内存里也保持同样的上限 */
const LINES_LIMIT = 5000

/** LogPane 的卡头 44 + 收口 40，剩余高度全部给日志区 */
const LOG_CARD_CHROME = 44 + 40

/** `service.start` / `service.restart` 的返回；`ipc-types` 在 app/ 下不能改，契约就放页面里 */
interface ServiceStartResult {
  readonly state: 'running' | 'starting'
  readonly pid?: number
}

const STATE_LABEL = {
  running: '运行中',
  stopped: '已停止',
  starting: '启动中',
  unknown: '状态未知',
} as const

function isServiceLogEvent(value: unknown): value is ServiceLogEvent {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { line, stream } = value as { line?: unknown; stream?: unknown }
  return typeof line === 'string' && (stream === 'stdout' || stream === 'stderr')
}

interface ToastState {
  tone: 'error'
  message: string
}

export function ServicePage() {
  const host = useHost()
  const status = useRequest<SystemStatus>('system.status')
  // 「查看全部日志」把 tail 提到后端上限，复用同一条读取路径，不新增方法。
  const [fullLogs, setFullLogs] = useState(false)
  const logs = useRequest<ServiceLogsResult>('service.logs', {
    tail: fullLogs ? LOG_TAIL_FULL : LOG_TAIL,
  })
  const [lines, setLines] = useState<LogLine[]>([])
  const [busy, setBusy] = useState<ServiceAction | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  /** starting 是本地进行中态：契约里 system.status 只给 running/stopped/unknown */
  const [starting, setStarting] = useState(false)
  /** 轮询拿到的最新快照；在 hook 的 reload 完成前顶替旧 data */
  const [liveStatus, setLiveStatus] = useState<SystemStatus | null>(null)
  /** 轮询自己的 system.status 失败，和 hook 的读取错误走同一个错误分支 */
  const [pollError, setPollError] = useState<HostError | null>(null)
  /** 0 只是首帧占位，布局测量后立刻替换成实际剩余高度 */
  const [logHeight, setLogHeight] = useState(0)
  const logAreaRef = useRef<HTMLDivElement | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const awaitingReloadRef = useRef(false)
  const sawReloadLoadingRef = useRef(false)

  // 状态卡先按骨架画出来，数据到了只替换文字，避免加载时页面空一截。
  // 错误态优先于旧 data：useRequest 失败时会保留旧 data，不能拿它冒充当前状态。
  const readError = pollError ?? status.error
  const displayStatus = liveStatus ?? status.data
  const baseState = readError === null ? displayStatus?.service.state : undefined
  const running = baseState === 'running'
  const stopped = baseState === 'stopped'
  const ready = !starting && !status.loading && readError === null && displayStatus !== null
  const statusLabel = starting
    ? STATE_LABEL.starting
    : readError !== null
      ? '无法读取服务状态'
      : displayStatus
        ? STATE_LABEL[baseState ?? 'unknown']
        : status.loading
          ? '读取中'
          : '状态未知'

  const { reload: reloadStatus } = status
  const { reload: reloadLogs } = logs

  // 快照是权威、事件只追加；快照回来时整段替换是刻意行为，不做快照/事件的复杂合并。
  useEffect(() => {
    if (!logs.data) {
      return
    }
    const now = clockTime()
    setLines(logs.data.lines.map((line) => parseLogLine(line, now)))
  }, [logs.data])

  // service.start/restart 返回 starting 时 systemctl 还没等到端口，轮询到探测出结果为止。
  useEffect(() => {
    if (!starting) {
      return
    }
    let cancelled = false
    const startedAt = Date.now()

    const finish = () => {
      if (cancelled) {
        return
      }
      setStarting(false)
      // 等 useRequest 完成这次 reload 再释放 liveStatus，避免闪回旧状态
      awaitingReloadRef.current = true
      sawReloadLoadingRef.current = false
      reloadStatus()
    }

    const tick = async () => {
      try {
        const next = (await host.request('system.status')) as SystemStatus
        if (cancelled) {
          return
        }
        setLiveStatus(next)
        if (next.service.state === 'running' || next.service.state === 'stopped') {
          finish()
          reloadLogs()
          return
        }
        if (Date.now() - startedAt >= START_POLL_TIMEOUT_MS) {
          // 超时也退出轮询并恢复按钮；最后一次快照仍是有效状态
          finish()
          return
        }
        pollTimerRef.current = window.setTimeout(() => {
          pollTimerRef.current = null
          void tick()
        }, START_POLL_MS)
      } catch (failure) {
        if (cancelled) {
          return
        }
        // 轮询失败要落到状态卡错误分支，不能一直停在「启动中」
        setPollError(normalizeHostError(failure))
        setStarting(false)
        // 顺手刷新 hook：重试期间 status.error 会一直保留，避免闪回旧 data
        reloadStatus()
      }
    }

    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null
      void tick()
    }, START_POLL_MS)

    return () => {
      cancelled = true
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [starting, host, reloadStatus, reloadLogs])

  // reload 结束后用 hook 里的新 data 替换 liveStatus；失败则让错误分支接管
  useEffect(() => {
    if (!awaitingReloadRef.current) {
      return
    }
    if (status.loading) {
      sawReloadLoadingRef.current = true
      return
    }
    if (!sawReloadLoadingRef.current) {
      return
    }
    awaitingReloadRef.current = false
    sawReloadLoadingRef.current = false
    setLiveStatus(null)
  }, [status.loading])

  useHostEvent('event.service.log', (params) => {
    if (!isServiceLogEvent(params)) {
      return
    }
    const now = clockTime()
    const incoming = params.line
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => parseLogLine(line, now))
    if (incoming.length === 0) {
      return
    }
    setLines((current) => {
      const next = [...current, ...incoming]
      // 事件可以比快照多得多；只保留最近 5000 行，避免长时间运行后内存无限增长
      return next.length > LINES_LIMIT ? next.slice(-LINES_LIMIT) : next
    })
  })

  useLayoutEffect(() => {
    const node = logAreaRef.current
    if (!node) {
      return
    }
    const sync = () => {
      const next = Math.max(0, Math.round(node.clientHeight) - LOG_CARD_CHROME)
      setLogHeight((current) => (current === next ? current : next))
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }
    },
    []
  )

  const notifyFailure = useCallback((failure: HostError) => {
    setToast({ tone: 'error', message: `操作失败：${failure.message}` })
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, TOAST_MS)
  }, [])

  /** 写操作一次一个：成功刷新状态与日志快照，失败完整交给 Toast，不吞错误 */
  const run = async (action: ServiceAction) => {
    if (busy !== null || starting || !ready || (action === 'start' ? !stopped : !running)) {
      return
    }
    setBusy(action)
    setPollError(null)
    try {
      const result = (await host.request(`service.${action}`)) as ServiceStartResult
      if (action !== 'stop' && result.state === 'starting') {
        // 后端只保证 systemctl 已返回；先进入本地启动中，由轮询 effect 继续探测
        setStarting(true)
        reloadLogs()
      } else {
        reloadStatus()
        reloadLogs()
      }
    } catch (failure) {
      notifyFailure(normalizeHostError(failure))
    } finally {
      setBusy(null)
    }
  }

  const retryStatus = () => {
    setPollError(null)
    setLiveStatus(null)
    reloadStatus()
  }

  const retryLogs = () => {
    reloadLogs()
    reloadStatus()
  }

  /** 错误时不拿旧 data 填充右侧元信息，避免看起来像刚刚探测过 */
  const meta = readError === null ? displayStatus : null
  const actionDisabled = busy !== null || starting || !ready

  const headActions = running ? (
    <>
      <Button
        tone="secondary"
        icon={<RefreshIcon size={15} />}
        disabled={actionDisabled}
        onClick={() => {
          void run('restart')
        }}
      >
        {starting ? '启动中…' : busy === 'restart' ? '重启中…' : '重启'}
      </Button>
      <Button
        tone="danger"
        icon={<PowerIcon size={15} />}
        disabled={actionDisabled}
        onClick={() => {
          void run('stop')
        }}
      >
        {busy === 'stop' ? '停止中…' : '停止服务'}
      </Button>
    </>
  ) : (
    <Button
      tone="primary"
      icon={<PowerIcon size={15} />}
      disabled={actionDisabled || !stopped}
      onClick={() => {
        void run('start')
      }}
    >
      {starting || busy === 'start' ? '启动中…' : '启动服务'}
    </Button>
  )

  return (
    <>
      <PageHead title="服务" actions={headActions} />
      <PageBody>
        <Card className={styles.statusCard}>
          <h2 className="cd-sr-only">服务状态</h2>
          {readError ? (
            <div className={styles.statusError} role="alert">
              <div className={styles.statusLine}>
                <AlertTriangleIcon size={18} className={styles.statusErrorIcon} />
                <span className={styles.statusWord}>无法读取服务状态</span>
              </div>
              <span className={styles.statusErrorText}>
                {readError.code} · {readError.message}
              </span>
              <Button tone="secondary" size="sm" disabled={status.loading} onClick={retryStatus}>
                {status.loading ? '重试中…' : '重试'}
              </Button>
            </div>
          ) : (
            <div className={styles.statusMain} aria-live="polite">
              <div className={styles.statusLine}>
                <span
                  className={`${styles.dot} ${
                    starting ? styles.dotStarting : running ? styles.dotRunning : styles.dotStopped
                  }`}
                  aria-hidden="true"
                />
                <span className={styles.statusWord}>{statusLabel}</span>
              </div>
              <span className={styles.statusSub}>serve 子命令 · 本机回环 · {START_MODE}</span>
            </div>
          )}
          <dl className={styles.meta}>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>监听地址</dt>
              <dd className={`${styles.metaValue} ${styles.mono}`}>
                {meta?.service.listen ?? '—'}
              </dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>版本</dt>
              <dd className={`${styles.metaValue} ${styles.mono}`}>{meta?.version ?? '—'}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>数据目录</dt>
              <dd className={`${styles.metaValue} ${styles.mono}`} title={meta?.dataDir}>
                {meta?.dataDir ?? '—'}
              </dd>
            </div>
          </dl>
        </Card>
        <div ref={logAreaRef} className={styles.logArea}>
          {logs.error ? (
            <Card clip>
              <CardHeader title="最近日志" />
              <div className={styles.errorBody} style={{ height: logHeight }}>
                <EmptyState
                  icon={<AlertTriangleIcon size={20} />}
                  title="日志读取失败"
                  description={`${logs.error.code} · ${logs.error.message}`}
                  action={
                    <Button tone="secondary" size="sm" disabled={logs.loading} onClick={retryLogs}>
                      {logs.loading ? '重试中…' : '重试'}
                    </Button>
                  }
                />
              </div>
              <CardFooter>日志不可用</CardFooter>
            </Card>
          ) : (
            <LogPane
              title="最近日志"
              lines={lines}
              count={lines.length}
              height={logHeight}
              emptyText={logs.loading && !logs.data ? '正在读取日志…' : '暂无日志'}
              onClear={() => {
                // 只清本地显示；下一次读取或事件会重新填充
                setLines([])
              }}
              // 快照已是全部（后端上限）时收起收口链接，避免点了没反应
              footerAction={
                fullLogs || logs.loading
                  ? undefined
                  : { label: '查看全部日志', onClick: () => setFullLogs(true) }
              }
            />
          )}
        </div>
        {toast ? (
          <Toast tone={toast.tone} className={styles.toast}>
            {toast.message}
          </Toast>
        ) : null}
      </PageBody>
    </>
  )
}
