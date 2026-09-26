import { Bell, Languages, LogOut, Moon, Search, SquarePen, Sun, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { BrandMark } from '@/components/ui/BrandMark'
import { Button, IconButton, focusRing } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { ConversationAction, User } from '@/types/chat'
import { ConversationList, type ConversationItem } from './ConversationList'

export type Filter = 'all' | 'unread' | 'groups' | 'requests'

interface SidebarProps {
  items: ConversationItem[]
  unreadTotal: number
  /** Message requests from people who aren't your friends. */
  requestCount: number
  selectedId: string | null
  currentUser: User
  query: string
  filter: Filter
  theme: 'light' | 'dark'
  onQueryChange: (q: string) => void
  onFilterChange: (f: Filter) => void
  onSelect: (id: string) => void
  onConversationAction: (id: string, action: ConversationAction) => void
  onToggleTheme: () => void
  onNewChat: () => void
  onSignOut: () => void
  onOpenFriends: () => void
  friendsActive: boolean
  onOpenProfile: () => void
  profileActive: boolean
  /** Friend requests waiting for an answer. */
  friendRequests: number
  /** Notifications you haven't seen. */
  unreadNotifications: number
  onOpenNotifications: () => void
  /** Shown instead of the list while loading, on error, or when there are no conversations. */
  listPlaceholder?: ReactNode
  className?: string
  /** Messages matching the search (undefined: not searching messages). */
  messageResults?: { id: string; conversationId: string; title: string; content: string; createdAt: string }[]
  searchingMessages?: boolean
  onOpenMessage?: (conversationId: string, messageId: string) => void
}

/** Characters shown before a search match, so it's visible in a two-line preview. */
const MATCH_CONTEXT_CHARS = 30

/** The text with the searched words marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  const at = q ? text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase()) : -1
  if (at < 0) return <>{text}</>
  const from = Math.max(0, at - MATCH_CONTEXT_CHARS)
  return (
    <>
      {from > 0 && '…'}
      {text.slice(from, at)}
      <mark className="rounded-sm bg-accent-soft px-0.5 text-ink">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

export function Sidebar(props: SidebarProps) {
  const { t, lang, setLang, fmt } = useLocale()
  const { items, unreadTotal, selectedId, currentUser, query, filter, theme } = props

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t.filterAll },
    { id: 'unread', label: unreadTotal > 0 ? t.filterUnreadCount(fmt.number(unreadTotal)) : t.filterUnread },
    { id: 'groups', label: t.filterGroups },
  ]
  // The requests tab only shows up when there is something in it (or you're on it).
  if (props.requestCount > 0 || filter === 'requests') {
    filters.push({ id: 'requests', label: t.filterRequests(fmt.number(props.requestCount)) })
  }

  return (
    <aside className={cn('flex min-h-0 flex-col bg-surface md:rounded-3xl md:shadow-xs', props.className)}>
      <header className="flex h-18 shrink-0 items-center justify-between gap-3 px-5">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-title-3 font-extrabold text-ink">{lang === 'ar' ? 'همسة' : 'Hamsa'}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="relative">
            <IconButton label={t.friends.open} active={props.friendsActive} onClick={props.onOpenFriends}>
              <Users size={18} strokeWidth={1.75} />
            </IconButton>
            {props.friendRequests > 0 && (
              <Badge
                count={props.friendRequests}
                className="pointer-events-none absolute -inset-e-1 -top-1 ring-2 ring-surface"
              />
            )}
          </span>
          <Button size="sm" onClick={props.onNewChat} icon={<SquarePen size={16} strokeWidth={1.75} aria-hidden />}>
            {t.newChat}
          </Button>
        </div>
      </header>

      <div className="px-4">
        <label className="flex h-10 items-center gap-2 rounded-xl bg-surface-sunken px-3 ring-inset has-[input:focus]:shadow-[0_0_0_4px_var(--accent-soft)] has-[input:focus]:ring-[1.5px] has-[input:focus]:ring-focus-ring">
          <Search size={16} strokeWidth={1.75} className="shrink-0 text-ink-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-1" role="group">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => props.onFilterChange(f.id)}
              className={cn(
                'h-8 rounded-full px-3 text-caption font-semibold transition-colors duration-150',
                focusRing,
                filter === f.id ? 'bg-ink text-canvas' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {props.listPlaceholder ?? (
          <ConversationList
            items={items}
            selectedId={selectedId}
            currentUserId={currentUser.id}
            onSelect={props.onSelect}
            onAction={props.onConversationAction}
          />
        )}

        {props.messageResults && (
          <section aria-label={t.searchResults.messages} className="mt-3 border-t border-line pt-3">
            <h2 className="flex items-center gap-2 px-3 pb-1 text-overline text-ink-muted uppercase">
              {t.searchResults.messages}
              {props.searchingMessages && <Spinner />}
            </h2>
            {props.messageResults.length === 0 && !props.searchingMessages ? (
              <p className="px-3 py-2 text-body text-ink-muted">{t.searchResults.none}</p>
            ) : (
              <ul className="flex flex-col">
                {props.messageResults.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() => props.onOpenMessage?.(result.conversationId, result.id)}
                      className={cn(
                        'flex w-full flex-col rounded-2xl px-3 py-2 text-start hover:bg-surface-hover',
                        focusRing,
                      )}
                    >
                      <span className="flex w-full items-baseline justify-between gap-2">
                        <span dir="auto" className="min-w-0 truncate text-name text-ink">
                          {result.title}
                        </span>
                        <span className="shrink-0 text-meta text-ink-subtle">{fmt.listTime(result.createdAt)}</span>
                      </span>
                      <span dir="auto" className="line-clamp-2 text-preview text-ink-muted">
                        <Highlight text={result.content} query={query} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-2">
        <button
          type="button"
          onClick={props.onOpenProfile}
          aria-label={t.profile.open}
          aria-pressed={props.profileActive}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors duration-150',
            focusRing,
            props.profileActive
              ? 'bg-surface-selected [--ring:var(--surface-selected)]'
              : 'hover:bg-surface-hover hover:[--ring:var(--surface-hover)]',
          )}
        >
          <Avatar id={currentUser.id} name={currentUser.name} src={currentUser.avatarUrl} online />
          <span className="min-w-0 flex-1">
            <span
              dir="auto"
              className={cn('block truncate text-body font-bold text-ink', lang === 'ar' ? 'text-right' : 'text-left')}
            >
              {currentUser.name}
            </span>
            {currentUser.username && (
              <span
                dir="ltr"
                className={cn('block truncate text-caption text-ink-muted', lang === 'ar' ? 'text-right' : 'text-left')}
              >
                @{currentUser.username}
              </span>
            )}
          </span>
        </button>
        <span className="relative">
          <IconButton label={t.notifications.open} onClick={props.onOpenNotifications}>
            <Bell size={18} strokeWidth={1.75} />
          </IconButton>
          {props.unreadNotifications > 0 && (
            <Badge
              count={props.unreadNotifications}
              className="pointer-events-none absolute -inset-e-1 -top-1 ring-2 ring-surface"
            />
          )}
        </span>
        <IconButton label={theme === 'dark' ? t.themeToLight : t.themeToDark} onClick={props.onToggleTheme}>
          {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </IconButton>
        <IconButton label={t.switchLanguage} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
          <Languages size={18} strokeWidth={1.75} />
        </IconButton>
        <IconButton label={t.signOut} onClick={props.onSignOut}>
          <LogOut size={18} strokeWidth={1.75} className="rtl:-scale-x-100" />
        </IconButton>
      </footer>
    </aside>
  )
}
