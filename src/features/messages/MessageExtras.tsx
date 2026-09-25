import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Message } from '@/types/chat'
import { messagePreview } from '@/features/conversations/preview'
import { useLinkPreview } from './queries'
import { useThread } from './threadContext'

/** The quoted message at the top of a reply; clicking it scrolls to the original. */
export function ReplyQuote({ replyToId, out }: { replyToId: string; out: boolean }) {
  const { t } = useLocale()
  const { byId, users, currentUserId, onJump } = useThread()
  const quoted = byId.get(replyToId)
  const sender = quoted ? (quoted.senderId === currentUserId ? t.you : users[quoted.senderId]?.name) : undefined
  const text = !quoted ? t.msg.original : quoted.deletedAt ? t.msg.deleted : messagePreview(quoted, t)

  return (
    <button
      type="button"
      onClick={() => onJump(replyToId)}
      className={cn(
        'mb-1 block w-full min-w-40 rounded-lg border-s-4 px-2 py-1 text-start focus-visible:outline-2 focus-visible:outline-focus-ring',
        out ? 'border-accent bg-surface/50' : 'border-accent bg-accent-soft',
      )}
    >
      {sender && <span dir="auto" className="block truncate text-caption font-bold">{sender}</span>}
      <span dir="auto" className="line-clamp-2 text-caption opacity-80">{text}</span>
    </button>
  )
}

/** Grouped reactions under a bubble. Yours is highlighted; clicking it takes it back. */
export function Reactions({ message, out }: { message: Message; out: boolean }) {
  const { t } = useLocale()
  const { users, currentUserId, onReact } = useThread()
  const reactions = message.reactions ?? []
  if (reactions.length === 0) return null

  const groups = new Map<string, string[]>()
  for (const r of reactions) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r.userId])
  const mine = reactions.find((r) => r.userId === currentUserId)?.emoji

  return (
    <div className={cn('-mt-1.5 flex flex-wrap gap-1 px-1', out ? 'justify-end' : 'justify-start')}>
      {[...groups].map(([emoji, userIds]) => {
        const names = userIds.map((id) => (id === currentUserId ? t.you : users[id]?.name ?? '')).join(', ')
        const isMine = emoji === mine
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(message, isMine ? null : emoji)}
            title={names}
            aria-label={t.msg.reactedWith(emoji, names)}
            aria-pressed={isMine}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-caption shadow-xs ring-1 focus-visible:outline-2 focus-visible:outline-focus-ring',
              isMine ? 'bg-accent-soft ring-accent' : 'bg-surface-raised ring-line',
            )}
          >
            <span aria-hidden>{emoji}</span>
            {userIds.length > 1 && <span className="tabular-nums text-ink-muted">{userIds.length}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Title and description of the first link, fetched by the server. No images: see link-preview. */
export function LinkPreviewCard({ url, out }: { url: string; out: boolean }) {
  const preview = useLinkPreview(url)
  if (!preview.data) return null
  const { title, description, siteName } = preview.data
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        'mt-1.5 block max-w-68 rounded-lg border-s-4 px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-focus-ring',
        out ? 'border-accent bg-surface/50' : 'border-accent bg-surface-sunken',
      )}
    >
      {siteName && <span dir="auto" className="block truncate text-meta uppercase opacity-70">{siteName}</span>}
      {title && <span dir="auto" className="line-clamp-2 text-caption font-bold">{title}</span>}
      {description && <span dir="auto" className="mt-0.5 line-clamp-2 text-caption opacity-80">{description}</span>}
    </a>
  )
}
