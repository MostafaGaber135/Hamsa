import { Search, Share2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { Spinner } from '@/components/ui/Spinner'
import { useLocale } from '@/lib/i18n'
import { pathFor } from '@/lib/router'
import { useDebounced } from '@/lib/useDebounced'
import type { User } from '@/types/chat'
import { MIN_SEARCH_CHARS, toHandle } from './api'
import { Empty, PersonRow, Section } from './PeopleList'
import { usePeopleSearch, useSuggestions } from './queries'

interface FindPeopleProps {
  actionsFor: (user: User) => ReactNode
  /** Your username, for your own invite link. */
  myUsername?: string
  /** Opened from someone's invite link: search for them straight away. */
  initialQuery?: string
}

/**
 * The "Find people" tab. Nobody can browse Hamsa's users: you find someone by the
 * start of their username, by their invite link, or among friends of your friends.
 */
export function FindPeople({ actionsFor, myUsername, initialQuery = '' }: FindPeopleProps) {
  const { t, fmt } = useLocale()
  const [query, setQuery] = useState(initialQuery)
  const debounced = useDebounced(query)
  const search = usePeopleSearch(debounced)
  const typed = toHandle(query)
  const searching = toHandle(debounced).length >= MIN_SEARCH_CHARS

  return (
    <div className="flex flex-col gap-6">
      {myUsername && <InviteLink username={myUsername} />}

      <div>
        <label className="flex h-11 items-center gap-2 rounded-xl bg-surface-sunken px-3 ring-inset has-[input:focus]:shadow-[0_0_0_4px_var(--accent-soft)] has-[input:focus]:ring-[1.5px] has-[input:focus]:ring-focus-ring">
          <Search size={18} strokeWidth={1.75} className="shrink-0 text-ink-muted" aria-hidden />
          <input
            autoFocus
            type="search"
            dir="ltr"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.friends.search}
            aria-label={t.friends.search}
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted rtl:placeholder:text-right"
          />
          {search.isFetching && <Spinner />}
        </label>

        <div className="mt-4">
          {typed.length > 0 && typed.length < MIN_SEARCH_CHARS ? (
            <Empty text={t.friends.typeToSearch(fmt.number(MIN_SEARCH_CHARS))} />
          ) : !searching ? null : search.isError ? (
            <Empty text={t.loadError} />
          ) : search.data?.length === 0 ? (
            <Empty text={t.friends.noResults} />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {search.data?.map((user) => (
                <PersonRow key={user.id} user={user} actions={actionsFor(user)} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {!typed && <Suggestions actionsFor={actionsFor} />}
    </div>
  )
}

/** Your own link: whoever opens it lands here, searching for you. */
function InviteLink({ username }: { username: string }) {
  const { t } = useLocale()
  const link = `${window.location.origin}${pathFor({ name: 'add', username })}`
  const canShare = typeof navigator.share === 'function'

  return (
    <Section title={t.friends.inviteTitle}>
      <div className="flex flex-col gap-2 px-2">
        <p className="text-caption text-ink-muted">{t.friends.inviteHint}</p>
        <p dir="ltr" className="truncate rounded-xl bg-surface-sunken px-3 py-2 text-caption text-ink select-all">
          {link}
        </p>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={link} label={t.friends.copyLink} copiedLabel={t.friends.copied} />
          {canShare && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Share2 size={14} strokeWidth={1.75} aria-hidden />}
              // Cancelling the share sheet rejects; nothing to do then.
              onClick={() =>
                navigator.share({ title: t.friends.inviteText(`@${username}`), url: link }).catch(() => undefined)
              }
            >
              {t.friends.shareLink}
            </Button>
          )}
        </div>
      </div>
    </Section>
  )
}

/** Friends of your friends; hidden when there are none. */
function Suggestions({ actionsFor }: { actionsFor: (user: User) => ReactNode }) {
  const { t, fmt } = useLocale()
  const suggestions = useSuggestions()
  if (!suggestions.data?.length) return null

  return (
    <Section title={t.friends.suggestions}>
      <ul className="flex flex-col gap-0.5">
        {suggestions.data.map(({ user, mutualFriends }) => (
          <PersonRow
            key={user.id}
            user={user}
            note={t.friends.mutualFriends(mutualFriends, fmt.number(mutualFriends))}
            actions={actionsFor(user)}
          />
        ))}
      </ul>
    </Section>
  )
}
