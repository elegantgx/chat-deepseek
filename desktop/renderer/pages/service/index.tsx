import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PageBody, PageHead } from '../../app'
import type { ServiceLogEvent } from '../../app/ipc-types'
import { Button, Card, LogPane, PowerIcon, RefreshIcon } from '../../ui'
import type { LogLine } from '../../ui'
import {
  SERVICE_LOGS_RESULT,
  SERVICE_RESTART_EVENTS,
  SERVICE_START_EVENTS,
  SERVICE_START_MODE,
  SERVICE_STOP_EVENTS,
  serviceStatus,
} from './fixtures'
import { parseLogLine } from './logs'
import styles from './service.module.css'

type ServiceAction = 'start' | 'stop' | 'restart'

const ACTION_EVENTS: Record<ServiceAction, readonly ServiceLogEvent[]> = {
  start: SERVICE_START_EVENTS,
  stop: SERVICE_STOP_EVENTS,
  restart: SERVICE_RESTART_EVENTS,
}

/** 操作延迟，样本阶段用它模拟 ipc 的一次往返 */
const ACTION_DELAY_MS = 800

/** LogPane 的卡头 44 + 收口 40，剩余高度全部给日志区 */
const LOG_CARD_CHROME = 44 + 40

/** `#service-off` 表示已停止；`#dark-service-off` 之类不认识的尾巴由外壳忽略 */
function initiallyRunning(): boolean {
  return !/(^|-)off($|-)/.test(window.location.hash.replace(/^#\/?/, ''))
}

export function ServicePage() {
  const [running, setRunning] = useState(initiallyRunning)
  const [lines, setLines] = useState<LogLine[]>(() =>
    SERVICE_LOGS_RESULT.lines.map((line) => parseLogLine(line))
  )
  const [busy, setBusy] = useState<ServiceAction | null>(null)
  /** 0 只是首帧占位，布局测量后立刻替换成实际剩余高度 */
  const [logHeight, setLogHeight] = useState(0)
  const logAreaRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)

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
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    },
    []
  )

  const run = (action: ServiceAction) => {
    if (busy !== null) {
      return
    }
    setBusy(action)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setLines((current) => [
        ...current,
        ...ACTION_EVENTS[action].map((event) => parseLogLine(event.line)),
      ])
      setRunning(action !== 'stop')
      setBusy(null)
    }, ACTION_DELAY_MS)
  }

  const status = serviceStatus(running)

  return (
    <>
      <PageHead
        title="服务"
        actions={
          running ? (
            <>
              <Button
                tone="secondary"
                icon={<RefreshIcon size={15} />}
                disabled={busy !== null}
                onClick={() => {
                  run('restart')
                }}
              >
                {busy === 'restart' ? '重启中…' : '重启'}
              </Button>
              <Button
                tone="danger"
                icon={<PowerIcon size={15} />}
                disabled={busy !== null}
                onClick={() => {
                  run('stop')
                }}
              >
                {busy === 'stop' ? '停止中…' : '停止服务'}
              </Button>
            </>
          ) : (
            <Button
              tone="primary"
              icon={<PowerIcon size={15} />}
              disabled={busy !== null}
              onClick={() => {
                run('start')
              }}
            >
              {busy === 'start' ? '启动中…' : '启动服务'}
            </Button>
          )
        }
      />
      <PageBody>
        <Card className={styles.statusCard}>
          <h2 className="cd-sr-only">服务状态</h2>
          <div className={styles.statusMain} aria-live="polite">
            <div className={styles.statusLine}>
              <span
                className={`${styles.dot} ${running ? styles.dotRunning : styles.dotStopped}`}
                aria-hidden="true"
              />
              <span className={styles.statusWord}>{running ? '运行中' : '已停止'}</span>
            </div>
            <span className={styles.statusSub}>serve 子命令 · 本机回环 · {SERVICE_START_MODE}</span>
          </div>
          <dl className={styles.meta}>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>监听地址</dt>
              <dd className={`${styles.metaValue} ${styles.mono}`}>{status.service.listen}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>版本</dt>
              <dd className={`${styles.metaValue} ${styles.mono}`}>{status.version}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>数据目录</dt>
              <dd className={`${styles.metaValue} ${styles.mono}`} title={status.dataDir}>
                {status.dataDir}
              </dd>
            </div>
          </dl>
        </Card>
        <div ref={logAreaRef} className={styles.logArea}>
          <LogPane
            title="最近日志"
            lines={lines}
            count={lines.length}
            height={logHeight}
            onClear={() => {
              setLines([])
            }}
            footerAction={{ label: '查看全部日志' }}
          />
        </div>
      </PageBody>
    </>
  )
}
