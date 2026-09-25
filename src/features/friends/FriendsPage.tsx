import { ArrowLeft, Check, CircleAlert, MessageCircle, UserMinus, UserPlus, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm'
import { useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton, focusRing } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { FriendStatus, User } from '@/types/chat'
import { FindPeople } from './FindPeople'
import { Empty, Loading, PeopleList, Section } from './PeopleList'
import { useFriendAction, useFriendships } from './queries'

type Tab = 'friends' | 'requests' | 'find'

interface FriendsPageProps {
  /** Your username, for your invite link. */
  myUsername?: string
  /** Opened from someone's invite link (/add/<username>): find them. */
  inviteUsername?: string
  onBack: () => void
  onMessage: (user: User) => void
  messagingUserId?: string | null
}

export function FriendsPage({ myUsername, inviteUsername, onBack, onMessage, messagingUserId }: FriendsPageProps) {
  const { t, lang } = useLocale()
  const confirm = useConfirm()
  const friendships = useFriendships()
  const action = useFriendAction()
  const list = friendships.data ?? []
  const friends = list.filter((f) => f.status === 'friends')
  const incoming = list.filter((f) => f.status === 'incoming')
  const outgoing = list.filter((f) => f.status === 'outgoing')

  // An invite link opens the search; otherwise the requests tab when someone is waiting for an answer.
  const [tab, setTab] = useState<Tab>(() => (inviteUsername ? 'find' : incoming.length > 0 ? 'requests' : 'friends'))

  const statusOf = (userId: string): FriendStatus | undefined => list.find((f) => f.user.id === userId)?.status

  /** The buttons for one person, based on where you stand with them. */
  function actionsFor(user: User): ReactNode {
    const status = statusOf(user.id)
    const busy = action.isPending && action.variables?.user.id === user.id

    if (status === 'friends') {
      return (
        <>
          <Button
            size="sm"
            variant="secondary"
            disabled={messagingUserId === user.id}
            onClick={() => onMessage(user)}
            icon={<MessageCircle size={16} strokeWidth={1.75} aria-hidden />}
          >
            {t.friends.message}
          </Button>
          <IconButton
            size="sm"
            label={`${t.friends.remove}: ${user.name}`}
            disabled={busy}
            onClick={() => {
              void confirm({
                message: t.friends.removeConfirm(user.name),
                confirmLabel: t.friends.remove,
                danger: true,
              }).then((ok) => ok && action.mutate({ type: 'remove', user }))
            }}
          >
            <UserMinus size={16} strokeWidth={1.75} />
          </IconButton>
        </>
      )
    }
    if (status === 'incoming') {
      return (
        <>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => action.mutate({ type: 'accept', user })}
            icon={<Check size={16} strokeWidth={2} aria-hidden />}
          >
            {t.friends.accept}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => action.mutate({ type: 'decline', user })}>
            {t.friends.decline}
          </Button>
        </>
      )
    }
    if (status === 'outgoing') {
      return (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => action.mutate({ type: 'remove', user })}
          icon={<X size={16} strokeWidth={1.75} aria-hidden />}
        >
          {t.friends.cancel}
        </Button>
      )
    }
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => action.mutate({ type: 'add', user })}
        icon={<UserPlus size={16} strokeWidth={1.75} aria-hidden />}
      >
        {t.friends.add}
      </Button>
    )
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'friends', label: t.friends.tabFriends },
    { id: 'requests', label: t.friends.tabRequests, count: incoming.length },
    { id: 'find', label: t.friends.tabFind },
  ]

  return (
    <>
      <header className="flex h-18 shrink-0 items-center gap-3 border-b border-line px-3 md:px-5">
        <IconButton label={t.back} onClick={onBack} className="md:hidden">
          <ArrowLeft size={20} strokeWidth={1.75} className="rtl:-scale-x-100" />
        </IconButton>
        <h2 className={lang === 'ar' ? 'text-title-ar text-ink' : 'text-title-3 text-ink'}>{t.friends.title}</h2>
      </header>

      <div
        role="tablist"
        aria-label={t.friends.title}
        className="mx-auto flex w-full max-w-2xl shrink-0 gap-1 px-3 pt-3 md:px-0"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`friends-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls="friends-panel"
            onClick={() => setTab(item.id)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-full px-4 text-body font-semibold transition-colors duration-150',
              focusRing,
              tab === item.id ? 'bg-ink text-canvas' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
            )}
          >
            {item.label}
            {item.count ? <Badge count={item.count} /> : null}
          </button>
        ))}
      </div>

      <div
        id="friends-panel"
        role="tabpanel"
        aria-labelledby={`friends-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5"
      >
        <div className="mx-auto max-w-2xl">
          {action.error && (
            <p role="alert" className="mb-3 flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-body text-danger">
              <CircleAlert size={18} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
              <span dir="auto">{action.error.message}</span>
            </p>
          )}

          {friendships.isPending ? (
            <Loading label={t.loading} />
          ) : tab === 'friends' ? (
            <PeopleList people={friends} empty={t.friends.noFriends} actionsFor={actionsFor} />
          ) : tab === 'requests' ? (
            incoming.length + outgoing.length === 0 ? (
              <Empty text={t.friends.noRequests} />
            ) : (
              <div className="flex flex-col gap-6">
                {incoming.length > 0 && (
                  <Section title={t.friends.incoming}>
                    <PeopleList people={incoming} actionsFor={actionsFor} />
                  </Section>
                )}
                {outgoing.length > 0 && (
                  <Section title={t.friends.outgoing}>
                    <PeopleList people={outgoing} actionsFor={actionsFor} />
                  </Section>
                )}
              </div>
            )
          ) : (
            <FindPeople actionsFor={actionsFor} myUsername={myUsername} initialQuery={inviteUsername} />
          )}
        </div>
      </div>
    </>
  )
}
