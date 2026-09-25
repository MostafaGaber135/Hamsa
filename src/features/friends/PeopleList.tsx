import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Friendship, User } from '@/types/chat'

// The pieces the friends page's tabs share: a list of people, each with their buttons.

export function PeopleList({
  people,
  empty,
  actionsFor,
}: {
  people: Friendship[]
  empty?: string
  actionsFor: (u: User) => ReactNode
}) {
  if (people.length === 0 && empty) return <Empty text={empty} />
  return (
    <ul className="flex flex-col gap-0.5">
      {people.map((f) => (
        <PersonRow key={f.user.id} user={f.user} actions={actionsFor(f.user)} />
      ))}
    </ul>
  )
}

/** One person: photo, name, @username, an optional note ("2 mutual friends") and their buttons. */
export function PersonRow({ user, actions, note }: { user: User; actions: ReactNode; note?: string }) {
  const { lang } = useLocale()
  const align = lang === 'ar' ? 'text-right' : 'text-left'
  return (
    <li className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-surface-hover">
      <Avatar id={user.id} name={user.name} src={user.avatarUrl} size="lg" />
      <div className="min-w-0 flex-1">
        <p dir="auto" className={cn('truncate text-name text-ink', align)}>
          {user.name}
        </p>
        {user.username && (
          <p dir="ltr" className={cn('truncate text-caption text-ink-muted', align)}>
            @{user.username}
          </p>
        )}
        {note && <p className={cn('truncate text-caption text-ink-muted', align)}>{note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </li>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 px-2 text-caption font-bold text-ink-muted">{title}</h3>
      {children}
    </section>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="px-2 py-10 text-center text-body text-ink-muted">{text}</p>
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-body text-ink-muted">
      <Spinner />
      {label}
    </div>
  )
}
