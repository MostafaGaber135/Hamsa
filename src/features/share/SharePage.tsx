import { ArrowLeft, FileText, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { IconButton, focusRing } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { queueShare } from '@/features/messages/sharedIn'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { navigate } from '@/lib/router'
import type { Conversation, User } from '@/types/chat'
import { takeSharedItems, type SharedItems } from './storage'

interface SharePageProps {
  conversations: Conversation[]
  me: User
  onBack: () => void
}

/** "Share to Hamsa" from another app: choose the chat, then send from its message box. */
export function SharePage({ conversations, me, onBack }: SharePageProps) {
  const { t, lang } = useLocale()
  const [shared, setShared] = useState<SharedItems | null | undefined>(undefined)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    takeSharedItems().then((items) => {
      if (!cancelled) setShared(items)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const q = query.trim().toLocaleLowerCase()
  const targets = conversations
    .filter((c) => !c.isRequest)
    .map((c) => {
      const peer = c.isGroup ? undefined : c.members.find((m) => m.id !== me.id)
      return { conversation: c, peer, title: c.name ?? peer?.name ?? '' }
    })
    .filter((target) => target.title.toLocaleLowerCase().includes(q))

  function shareTo(conversationId: string) {
    if (!shared) return
    queueShare(conversationId, { text: shared.text || undefined, file: shared.files[0] })
    // Back from the chat returns to your list, not to this picker.
    navigate({ name: 'chat', id: conversationId }, { replace: true })
  }

  return (
    <>
      <header className="flex h-18 shrink-0 items-center gap-3 border-b border-line px-3 md:px-5">
        <IconButton label={t.back} onClick={onBack} className="md:hidden">
          <ArrowLeft size={20} strokeWidth={1.75} className="rtl:-scale-x-100" />
        </IconButton>
        <h2 className={lang === 'ar' ? 'text-title-ar text-ink' : 'text-title-3 text-ink'}>{t.share.title}</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 md:px-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {shared === undefined ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : shared === null ? (
            <p className="py-10 text-center text-body text-ink-muted">{t.share.nothing}</p>
          ) : (
            <>
              <section className="rounded-3xl bg-surface-raised p-4 ring-1 ring-line">
                {shared.files.map((file, i) => (
                  <p key={i} className="flex items-center gap-2 text-body text-ink">
                    <FileText size={16} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
                    <span dir="auto" className="truncate">{file.name}</span>
                  </p>
                ))}
                {shared.text && (
                  <p dir="auto" className="mt-1 line-clamp-3 text-body whitespace-pre-wrap text-ink-muted">{shared.text}</p>
                )}
                {shared.files.length > 1 && <p className="mt-2 text-caption text-ink-subtle">{t.share.firstFileOnly}</p>}
              </section>

              <label className="flex h-10 items-center gap-2 rounded-xl bg-surface-sunken px-3">
                <Search size={16} strokeWidth={1.75} className="shrink-0 text-ink-muted" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.search}
                  aria-label={t.search}
                  className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
                />
              </label>

              <ul aria-label={t.share.chooseChat} className="flex flex-col gap-0.5">
                {targets.map(({ conversation, peer, title }) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => shareTo(conversation.id)}
                      className={cn('flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-start hover:bg-surface-hover', focusRing)}
                    >
                      <Avatar
                        id={peer?.id ?? conversation.id}
                        name={title}
                        src={conversation.isGroup ? conversation.avatarUrl : peer?.avatarUrl}
                        group={conversation.isGroup}
                      />
                      <span dir="auto" className="min-w-0 flex-1 truncate text-name text-ink">{title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  )
}
