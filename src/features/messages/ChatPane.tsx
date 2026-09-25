import { ArrowLeft, PanelRight, Phone, Pin, Video, WifiOff } from 'lucide-react'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { messagePreview } from '@/features/conversations/preview'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { wallpaperStyle } from '@/lib/wallpapers'
import { useLocale } from '@/lib/i18n'
import type { Conversation, Message, User } from '@/types/chat'
import { Composer, type Draft } from './Composer'
import { isViewable } from './media'
import { MessageThread, type JumpTarget } from './MessageThread'
import { useMessageActions, usePinnedMessages } from './queries'
import { TypingInline } from './TypingIndicator'

const MediaViewer = lazy(() => import('./MediaViewer').then((m) => ({ default: m.MediaViewer })))

interface ChatPaneProps {
  conversation: Conversation
  title: string
  peer?: User
  messages: Message[]
  users: Record<string, User>
  currentUserId: string
  onBack: () => void
  onSend: (draft: Draft) => void
  /** Opens or closes the chat info panel. */
  onToggleDetails: () => void
  detailsOpen: boolean
  onTyping?: () => void
  /** Shows the "Reconnecting…" banner under the header. */
  connection?: 'connecting' | 'live' | 'lost'
  onRetry: (message: Message) => void
  hasOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
  /** Replaces the thread while messages load or fail. */
  threadPlaceholder?: ReactNode
  /** A blocked one-to-one chat shows a notice instead of the message box. */
  blocked?: 'byMe' | 'byThem'
  onUnblock?: () => void
  /** A message request from someone who isn't your friend: accept, block or delete. */
  request?: { onAccept: () => void; onBlock: () => void; onDelete: () => void }
  /** Scroll to this message when it changes (e.g. a search result). */
  jumpTarget?: JumpTarget
  /** Start a voice or video call (one-to-one chats). */
  onCall?: (video: boolean) => void
}

export function ChatPane({
  conversation, title, peer, messages, users, currentUserId, onBack, onSend, onRetry,
  hasOlder, loadingOlder, onLoadOlder, threadPlaceholder, onTyping, connection, onToggleDetails, detailsOpen,
  blocked, onUnblock, request, jumpTarget, onCall,
}: ChatPaneProps) {
  const { t, fmt, lang } = useLocale()
  const [viewing, setViewing] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  // Jumps from this pane (the pinned bar); the latest of these and the parent's wins.
  const [localJump, setLocalJump] = useState<JumpTarget>()
  const jump = !localJump || (jumpTarget && jumpTarget.key > localJump.key) ? jumpTarget : localJump
  const { edit } = useMessageActions(conversation.id, currentUserId)
  const mentionable = conversation.isGroup ? conversation.members.filter((m) => m.id !== currentUserId) : []
  const viewable = messages.filter(isViewable)
  const align = lang === 'ar' ? 'text-right' : 'text-left'
  const typingUsers = (conversation.typingUserIds ?? []).map((id) => users[id]).filter(Boolean)

  let subtitle: ReactNode
  if (typingUsers.length > 0) subtitle = <TypingInline />
  else if (conversation.isGroup)
    subtitle = conversation.memberIds
      .map((id) => (id === currentUserId ? t.you : users[id]?.name.split(' ')[0]))
      .join(lang === 'ar' ? '، ' : ', ')
  else if (peer?.online) subtitle = <span className="text-presence">{t.online}</span>
  else if (peer?.lastSeenAt) subtitle = t.lastSeen(`${fmt.day(peer.lastSeenAt)} ${fmt.time(peer.lastSeenAt)}`)

  return (
    <>
      <header className="flex h-18 shrink-0 items-center gap-3 border-b border-line px-3 md:px-5">
        <IconButton label={t.back} onClick={onBack} className="md:hidden">
          <ArrowLeft size={20} strokeWidth={1.75} className="rtl:-scale-x-100" />
        </IconButton>
        {/* The name opens the chat info panel, like tapping a contact's name. */}
        <button
          type="button"
          onClick={onToggleDetails}
          aria-label={`${title} · ${t.details.open}`}
          className="-my-1 flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-1 pe-2 text-start hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus-ring md:-ms-2 md:ps-2"
        >
          <Avatar
            id={peer?.id ?? conversation.id}
            name={title}
            src={conversation.isGroup ? conversation.avatarUrl : peer?.avatarUrl}
            group={conversation.isGroup}
            online={!conversation.isGroup && peer?.online}
          />
          <span className="min-w-0">
            <span dir="auto" className={cn('block truncate text-name text-ink', align)}>{title}</span>
            <span className={cn('block truncate text-caption text-ink-muted', align)}>{subtitle}</span>
          </span>
        </button>
        {onCall && !blocked && (
          <>
            <IconButton label={t.call.audio} onClick={() => onCall(false)}>
              <Phone size={19} strokeWidth={1.75} />
            </IconButton>
            <IconButton label={t.call.video} onClick={() => onCall(true)} className="max-sm:hidden">
              <Video size={20} strokeWidth={1.75} />
            </IconButton>
          </>
        )}
        <IconButton label={t.details.open} active={detailsOpen} onClick={onToggleDetails}>
          <PanelRight size={20} strokeWidth={1.75} className="rtl:-scale-x-100" />
        </IconButton>
      </header>

      {connection === 'lost' && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-caption font-semibold text-warning"
        >
          <WifiOff size={14} strokeWidth={2} aria-hidden />
          {navigator.onLine ? t.reconnecting : t.offline}
        </div>
      )}

      <PinnedBar conversationId={conversation.id} onJump={(id) => setLocalJump({ id, key: Date.now() })} />

      {/* Your chosen background sits behind the messages and the composer. */}
      <div className="flex min-h-0 flex-1 flex-col" style={wallpaperStyle(conversation.wallpaper)}>
      {threadPlaceholder ?? (
      <MessageThread
        onOpen={(m) => setViewing(m.id)}
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        messages={messages}
        users={users}
        currentUserId={currentUserId}
        conversation={conversation}
        typingUsers={typingUsers}
        onRetry={onRetry}
        onReply={(message) => {
          setEditing(null)
          setReplyTo(message)
        }}
        onEdit={(message) => {
          setReplyTo(null)
          setEditing(message)
        }}
        jumpTarget={jump}
      />
      )}

      <div className="shrink-0 px-3 pt-1 pb-3 md:px-5 md:pb-5">
        {request && (
          <div
            role="region"
            aria-label={t.request.title}
            className="mb-2 flex flex-col items-center gap-3 rounded-3xl bg-surface-raised px-4 py-3 text-center ring-1 ring-line"
          >
            <p dir="auto" className="text-body text-ink-muted">{t.request.notice(title)}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={request.onAccept}>{t.request.accept}</Button>
              <Button size="sm" variant="secondary" onClick={request.onDelete}>{t.request.delete}</Button>
              <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={request.onBlock}>
                {t.request.block}
              </Button>
            </div>
          </div>
        )}
        {blocked ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-3xl bg-surface-raised px-4 py-3 text-center text-body text-ink-muted ring-1 ring-line"
          >
            <span dir="auto">{blocked === 'byMe' ? t.block.youBlocked(title) : t.block.cantReply}</span>
            {blocked === 'byMe' && onUnblock && (
              <Button variant="secondary" size="sm" onClick={onUnblock}>
                {t.privacySettings.unblock}
              </Button>
            )}
          </div>
        ) : (
          <Composer
            key={conversation.id}
            conversationId={conversation.id}
            recipientName={title}
            onSend={onSend}
            onTyping={onTyping}
            replyTo={
              replyTo
                ? { message: replyTo, senderName: replyTo.senderId === currentUserId ? t.you : (users[replyTo.senderId]?.name ?? '') }
                : undefined
            }
            onCancelReply={() => setReplyTo(null)}
            editing={editing ?? undefined}
            onSaveEdit={(message, content) => edit.mutate({ message, content })}
            onCancelEdit={() => setEditing(null)}
            mentionable={mentionable}
          />
        )}
      </div>
      </div>

      {viewing && (
        <Suspense fallback={null}>
          <MediaViewer items={viewable} startId={viewing} users={users} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </>
  )
}

/** The pinned messages, one at a time: a click jumps to it and shows the next. */
function PinnedBar({ conversationId, onJump }: { conversationId: string; onJump: (id: string) => void }) {
  const { t, fmt } = useLocale()
  const pinned = usePinnedMessages(conversationId)
  const [index, setIndex] = useState(0)
  const list = pinned.data ?? []
  if (list.length === 0) return null
  const current = list[index % list.length]

  return (
    <button
      type="button"
      onClick={() => {
        onJump(current.id)
        setIndex((i) => (i + 1) % list.length)
      }}
      className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2 text-start hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring md:px-6"
    >
      <Pin size={16} strokeWidth={2} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-caption font-bold text-accent">
          {t.msg.pinned(`${fmt.number((index % list.length) + 1)}/${fmt.number(list.length)}`)}
        </span>
        <span dir="auto" className="block truncate text-caption text-ink-muted">{messagePreview(current, t)}</span>
      </span>
    </button>
  )
}
