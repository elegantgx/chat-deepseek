import { Fragment, useState } from 'react'
import type { SessionSummary } from '../../../services/chat/types.js'
import { groupSessions } from '../../../services/chat/sessionGroups.js'
import { translate, useTranslate } from '../../../i18n/index.js'
import {
  Avatar,
  ChatIcon,
  Dialog,
  DrawerAccount,
  DrawerBody,
  DrawerSearch,
  DrawerSection,
  Empty,
  IconButton,
  MoreIcon,
  SessionRow,
  Sheet,
  SheetAction,
  SortIcon,
  UserCompactIcon,
} from '../../ui/index.js'
import { useStrings } from '../strings.js'
import { chatStrings } from './strings.js'
import styles from './ChatScreen.module.css'

export interface DrawerPanelProps {
  sessions: SessionSummary[]
  activeId: string | null
  account: string
  onClose: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => Promise<boolean>
  onAccount: () => void
}

/**
 * 会话抽屉：搜索、分组、选中行、底部账户。
 *
 * 没有直接用 `ui/Drawer` 的容器：示意里聊天页是「被推到右边、缩成一张圆角卡」，
 * 而不是常见的黑色遮罩抽屉；容器样式必须和页面 transform 成对出现。抽屉内部
 * 的搜索、分组头、会话行、账户行仍然复用 `ui/Drawer` 的子组件，尺寸不另起一套。
 */
export const DrawerPanel = ({
  sessions,
  activeId,
  account,
  onClose,
  onSelect,
  onDelete,
  onAccount,
}: DrawerPanelProps) => {
  const strings = useStrings(chatStrings)
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const [ascending, setAscending] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 会话数量是几十条的量级，直接算；不 memo 也顺便让分组标题跟随语言切换。
  const keyword = query.trim().toLocaleLowerCase()
  const matched = keyword
    ? sessions.filter((session) =>
        (session.title || t('untitledChat')).toLocaleLowerCase().includes(keyword)
      )
    : sessions
  const ordered = [...matched].sort((a, b) =>
    ascending ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt
  )

  // 空列表与“搜不到”给不同的话术：前者是还没开始聊，后者是换个词还能找到。
  const empty =
    sessions.length === 0 ? (
      <Empty
        icon={<ChatIcon size={26} />}
        title={strings.noSessions}
        description={strings.noSessionsDescription}
      />
    ) : ordered.length === 0 ? (
      <Empty
        icon={<ChatIcon size={26} />}
        title={strings.noSearchResults}
        description={strings.noSearchResultsDescription}
      />
    ) : null

  const groups = groupSessions(ordered, Date.now())
  const menuSession = menuId ? sessions.find((session) => session.id === menuId) : undefined
  const confirmSession = confirmId
    ? sessions.find((session) => session.id === confirmId)
    : undefined

  const confirmDelete = async () => {
    if (!confirmId || deleting) {
      return
    }
    setDeleting(true)
    const ok = await onDelete(confirmId)
    setDeleting(false)
    setConfirmId(null)
    if (ok) {
      setMenuId(null)
    }
  }

  return (
    <div className={styles.drawerLayer}>
      <button
        type="button"
        className={styles.drawerDismiss}
        aria-label={translate('close')}
        onClick={onClose}
      />
      <aside className={styles.drawerPanel} aria-label={strings.drawerLabel}>
        <DrawerSearch value={query} onChange={setQuery} placeholder={strings.searchPlaceholder} />
        <DrawerBody>
          {empty ?? (
            <>
              {groups.map((group, index) => (
                <Fragment key={group.key}>
                  <DrawerSection
                    title={group.label}
                    action={
                      index === 0 ? (
                        <button
                          type="button"
                          className={styles.sortButton}
                          aria-label={strings.sortByTime}
                          onClick={() => setAscending((value) => !value)}
                        >
                          <SortIcon size={20} />
                        </button>
                      ) : undefined
                    }
                  />
                  {group.sessions.map((session) => {
                    const active = session.id === activeId
                    return (
                      <SessionRow
                        key={session.id}
                        title={session.title || t('untitledChat')}
                        active={active}
                        more={
                          active ? (
                            <button
                              type="button"
                              className={styles.sessionMore}
                              aria-label={t('more')}
                              onClick={() => setMenuId(session.id)}
                            >
                              <MoreIcon size={18} />
                            </button>
                          ) : undefined
                        }
                        {...(active ? {} : { onClick: () => onSelect(session.id) })}
                      />
                    )
                  })}
                </Fragment>
              ))}
            </>
          )}
        </DrawerBody>
        <DrawerAccount
          avatar={<Avatar icon={<UserCompactIcon size={20} />} />}
          name={account || '—'}
          more={
            <IconButton
              label={strings.accountActions}
              size="md"
              className={styles.accountMore}
              onClick={onAccount}
            >
              <MoreIcon size={18} />
            </IconButton>
          }
        />
      </aside>

      <Sheet
        open={menuSession !== undefined}
        onClose={() => setMenuId(null)}
        title={menuSession?.title || t('untitledChat')}
        label={strings.sessionActions}
      >
        <SheetAction
          danger
          onClick={() => {
            if (menuSession) {
              setConfirmId(menuSession.id)
              setMenuId(null)
            }
          }}
        >
          {strings.deleteSessionAction}
        </SheetAction>
      </Sheet>

      <Dialog
        open={confirmSession !== undefined}
        title={strings.deleteSessionTitle}
        body={strings.deleteSessionDescription}
        cancelLabel={t('cancel')}
        confirmLabel={t('delete')}
        danger
        confirmDisabled={deleting}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}
