import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useFriendAction, useFriendships } from '@/features/friends/queries'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { AppNotification } from './api'
import { describeNotification } from './describe'
import { useMarkNotificationsRead, useNotifications } from './queries'

interface NotificationsDialogProps {
  onClose: () => void
  /** Go to what the notification is about (the chat, the message, the friends page). */
  onOpen: (notification: AppNotification) => void
}

/**
 * The bell's list: who did what, newest first. Opening it marks everything read,
 * while the ones that were new stay highlighted until it closes.
 * Mounted only while open; uses the native <dialog> (focus trapped, Esc closes).
 */
export function NotificationsDialog({ onClose, onOpen }: NotificationsDialogProps) {
  const { t, lang } = useLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const notifications = useNotifications()
  const { mutate: markRead } = useMarkNotificationsRead()
  const list = notifications.data

  // Which ones were new when the list first loaded, kept while it's open.
  const [fresh, setFresh] = useState<Set<string> | null>(null)
  if (list && fresh === null) setFresh(new Set(list.filter((n) => !n.read).map((n) => n.id)))

  const hasUnread = list?.some((n) => !n.read) ?? false
  useEffect(() => {
    if (hasUnread) markRead()
  }, [hasUnread, markRead])

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="notifications-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl bg-surface-raised p-0 text-ink shadow-lg backdrop:bg-scrim"
    >
      <div className="flex max-h-[min(640px,85dvh)] flex-col">
        <header className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 id="notifications-title" className={lang === 'ar' ? 'text-title-ar text-ink' : 'text-title-3 text-ink'}>
            {t.notifications.title}
          </h2>
          <IconButton label={t.notifications.close} size="sm" onClick={() => dialogRef.current?.close()}>
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </header>

        <div className="min-h-40 flex-1 overflow-y-auto px-3 pb-3">
          {notifications.isPending ? (
            <div role="status" className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : notifications.isError ? (
            <p className="px-2 py-10 text-center text-body text-ink-muted">{t.loadError}</p>
          ) : notifications.data.length === 0 ? (
            <p className="px-2 py-10 text-center text-body text-ink-muted">{t.notifications.empty}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {notifications.data.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  fresh={fresh?.has(n.id) ?? false}
                  onOpen={() => {
                    dialogRef.current?.close()
                    onOpen(n)
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  )
}

function NotificationRow({
  notification: n,
  fresh,
  onOpen,
}: {
  notification: AppNotification
  fresh: boolean
  onOpen: () => void
}) {
  const { t, fmt } = useLocale()
  const { text, quote } = describeNotification(n, t)

  return (
    <li className={cn('rounded-2xl', fresh && 'bg-accent-soft')}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 rounded-2xl px-2 py-2.5 text-start transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
      >
        <Avatar id={n.actor.id} name={n.actor.name} src={n.actor.avatarUrl} />
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block text-body text-ink">
            {text}
          </span>
          {quote && (
            <span dir="auto" className="mt-0.5 block truncate text-caption text-ink-muted">
              “{quote}”
            </span>
          )}
          <time dateTime={n.createdAt} className="mt-0.5 block text-meta text-ink-muted tabular-nums">
            {fmt.listTime(n.createdAt)}
          </time>
        </span>
        {fresh && <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-accent" />}
      </button>
      {n.kind === 'friend_request' && <RequestAnswer notification={n} />}
    </li>
  )
}

/** Accept or decline a friend request right from the list, while it's still waiting. */
function RequestAnswer({ notification: n }: { notification: AppNotification }) {
  const { t } = useLocale()
  const friendships = useFriendships()
  const action = useFriendAction()
  const status = friendships.data?.find((f) => f.user.id === n.actor.id)?.status
  const busy = action.isPending

  if (status === 'friends') {
    return <p className="ps-15 pb-2.5 text-caption font-semibold text-accent">{t.notifications.nowFriends}</p>
  }
  if (status !== 'incoming') return null
  return (
    <div className="flex gap-2 ps-15 pb-2.5">
      <Button
        size="sm"
        disabled={busy}
        onClick={() => action.mutate({ type: 'accept', user: n.actor })}
        icon={<Check size={16} strokeWidth={2} aria-hidden />}
      >
        {t.friends.accept}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => action.mutate({ type: 'decline', user: n.actor })}
      >
        {t.friends.decline}
      </Button>
    </div>
  )
}
