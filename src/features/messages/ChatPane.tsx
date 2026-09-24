import { ArrowLeft, PanelRight, WifiOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { IconButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { wallpaperStyle } from '@/lib/wallpapers'
import { useLocale } from '@/lib/i18n'
import type { Conversation, Message, User } from '@/types/chat'
import { Composer, type Draft } from './Composer'
import { isViewable } from './media'
import { MediaViewer } from './MediaViewer'
import { MessageThread } from './MessageThread'
import { TypingInline } from './TypingIndicator'

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
}

export function ChatPane({
  conversation, title, peer, messages, users, currentUserId, onBack, onSend, onRetry,
  hasOlder, loadingOlder, onLoadOlder, threadPlaceholder, onTyping, connection, onToggleDetails, detailsOpen,
}: ChatPaneProps) {
  const { t, fmt, lang } = useLocale()
  const [viewing, setViewing] = useState<string | null>(null)
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
        isGroup={conversation.isGroup}
        typingUsers={typingUsers}
        onRetry={onRetry}
      />
      )}

      <div className="shrink-0 px-3 pt-1 pb-3 md:px-5 md:pb-5">
        <Composer
          key={conversation.id}
          conversationId={conversation.id}
          recipientName={title}
          onSend={onSend}
          onTyping={onTyping}
        />
      </div>
      </div>

      {viewing && (
        <MediaViewer items={viewable} startId={viewing} users={users} onClose={() => setViewing(null)} />
      )}
    </>
  )
}
