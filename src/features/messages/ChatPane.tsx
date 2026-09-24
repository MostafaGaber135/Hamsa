import { ArrowLeft, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { IconButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Conversation, Message, User } from '@/types/chat'
import { Composer } from './Composer'
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
  onSend: (text: string, image?: File) => void
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
  hasOlder, loadingOlder, onLoadOlder, threadPlaceholder, onTyping, connection,
}: ChatPaneProps) {
  const { t, fmt, lang } = useLocale()
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
        <Avatar
          id={peer?.id ?? conversation.id}
          name={title}
        src={conversation.isGroup ? undefined : peer?.avatarUrl}
          group={conversation.isGroup}
          online={!conversation.isGroup && peer?.online}
        />
        <div className="min-w-0">
          <h2 dir="auto" className={cn('truncate text-name text-ink', align)}>{title}</h2>
          <p className="truncate text-caption text-ink-muted">{subtitle}</p>
        </div>
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

      {threadPlaceholder ?? (
      <MessageThread
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
    </>
  )
}
