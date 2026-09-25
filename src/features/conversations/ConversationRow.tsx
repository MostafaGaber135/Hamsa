import { Bell, BellOff, LogOut, MailCheck, MailWarning, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm'
import { useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Menu, type MenuAnchor, type MenuItem } from '@/components/ui/Menu'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Conversation, ConversationAction, Message, User } from '@/types/chat'
import { MessageStatusIcon } from '../messages/MessageStatusIcon'
import { messagePreview } from './preview'
import { TypingInline } from '../messages/TypingIndicator'

interface ConversationRowProps {
  conversation: Conversation
  title: string
  /** The other person in a 1:1 conversation. */
  peer?: User
  lastMessage?: Message
  lastSender?: User
  currentUserId: string
  selected: boolean
  tabIndex: number
  onSelect: () => void
  onAction: (action: ConversationAction) => void
  ref?: Ref<HTMLDivElement>
}

const ICON = { size: 18, strokeWidth: 1.75 }

export function ConversationRow({
  conversation,
  title,
  peer,
  lastMessage,
  lastSender,
  currentUserId,
  selected,
  tabIndex,
  onSelect,
  onAction,
  ref,
}: ConversationRowProps) {
  const { t, fmt, lang } = useLocale()
  const confirm = useConfirm()
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)

  const align = lang === 'ar' ? 'text-right' : 'text-left'
  const unread = conversation.unreadCount > 0 || Boolean(conversation.markedUnread)
  const typing = (conversation.typingUserIds?.length ?? 0) > 0
  const own = lastMessage?.senderId === currentUserId
  const previewText = messagePreview(lastMessage, t)
  const prefix = conversation.isGroup && lastMessage && !own && lastSender ? `${lastSender.name.split(' ')[0]}: ` : ''

  const items: MenuItem[] = [
    conversation.pinned
      ? { id: 'unpin', label: t.menu.unpin, icon: <PinOff {...ICON} />, onSelect: () => onAction('unpin') }
      : { id: 'pin', label: t.menu.pin, icon: <Pin {...ICON} />, onSelect: () => onAction('pin') },
    conversation.muted
      ? { id: 'unmute', label: t.menu.unmute, icon: <Bell {...ICON} />, onSelect: () => onAction('unmute') }
      : { id: 'mute', label: t.menu.mute, icon: <BellOff {...ICON} />, onSelect: () => onAction('mute') },
    unread
      ? { id: 'read', label: t.menu.markRead, icon: <MailCheck {...ICON} />, onSelect: () => onAction('markRead') }
      : {
          id: 'unread',
          label: t.menu.markUnread,
          icon: <MailWarning {...ICON} />,
          onSelect: () => onAction('markUnread'),
        },
    {
      id: 'delete',
      label: t.menu.delete,
      icon: <Trash2 {...ICON} />,
      danger: true,
      onSelect: () =>
        void confirm({ message: t.menu.deleteConfirm(title), confirmLabel: t.menu.delete, danger: true }).then(
          (ok) => ok && onAction('delete'),
        ),
    },
  ]
  if (conversation.isGroup) {
    items.push({
      id: 'leave',
      label: t.menu.leave,
      icon: <LogOut {...ICON} className="rtl:-scale-x-100" />,
      danger: true,
      onSelect: () =>
        void confirm({ message: t.menu.leaveConfirm(title), confirmLabel: t.menu.leave, danger: true }).then(
          (ok) => ok && onAction('leave'),
        ),
    })
  }

  // Shift+F10 or the Menu key opens the same menu from the keyboard.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      e.preventDefault()
      e.stopPropagation()
      if (rowRef.current) setMenu({ element: rowRef.current })
    }
  }

  const menuOpen = menu !== null

  return (
    <>
      <div
        ref={(el) => {
          rowRef.current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
        role="option"
        aria-selected={selected}
        aria-haspopup="menu"
        tabIndex={tabIndex}
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        className={cn(
          'group relative flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 select-none',
          'transition-colors duration-150 outline-none',
          // Keep the presence ring matched to whatever ground the row is on.
          selected
            ? 'bg-surface-selected [--ring:var(--surface-selected)]'
            : 'hover:bg-surface-hover hover:[--ring:var(--surface-hover)] focus-visible:bg-surface-hover focus-visible:[--ring:var(--surface-hover)] active:bg-surface-pressed active:[--ring:var(--surface-pressed)]',
          menuOpen && !selected && 'bg-surface-hover [--ring:var(--surface-hover)]',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
        )}
      >
        <Avatar
          id={peer?.id ?? conversation.id}
          name={title}
          src={conversation.isGroup ? conversation.avatarUrl : peer?.avatarUrl}
          size="lg"
          group={conversation.isGroup}
          online={!conversation.isGroup && peer?.online}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* dir="auto": text keeps its own direction; alignment follows the UI. */}
            <span dir="auto" className={cn('min-w-0 flex-1 truncate text-name text-ink', align)}>
              {title}
            </span>
            {lastMessage && (
              <time
                dateTime={lastMessage.createdAt}
                className={cn(
                  'text-meta tabular-nums group-hover:hidden group-focus-visible:hidden',
                  menuOpen && 'hidden',
                  unread && !conversation.muted ? 'font-bold text-accent' : 'text-ink-subtle',
                )}
              >
                {fmt.listTime(lastMessage.createdAt)}
              </time>
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label={t.more}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation()
                setMenu(menuOpen ? null : { element: e.currentTarget })
              }}
              className={cn(
                '-my-1 size-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-pressed hover:text-ink',
                menuOpen
                  ? 'inline-flex bg-surface-pressed text-ink'
                  : 'hidden group-hover:inline-flex group-focus-visible:inline-flex',
              )}
            >
              <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>

          <div className="mt-0.5 flex items-center gap-2">
            <span
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1 text-preview',
                unread ? 'font-semibold text-ink' : 'text-ink-muted',
              )}
            >
              {typing ? (
                <TypingInline />
              ) : (
                <>
                  {own && lastMessage?.status && <MessageStatusIcon status={lastMessage.status} />}
                  <span dir="auto" className={cn('truncate', align)}>
                    {prefix}
                    {previewText}
                  </span>
                </>
              )}
            </span>
            {conversation.muted && (
              <BellOff
                size={14}
                strokeWidth={1.75}
                className="shrink-0 text-ink-subtle"
                role="img"
                aria-label={t.menu.mute}
              />
            )}
            {conversation.pinned && (
              <Pin
                size={14}
                strokeWidth={1.75}
                className="shrink-0 text-ink-subtle"
                role="img"
                aria-label={t.menu.pinned}
              />
            )}
            {conversation.unreadCount > 0 ? (
              <Badge count={conversation.unreadCount} muted={conversation.muted} />
            ) : conversation.markedUnread ? (
              <Badge count={0} dot muted={conversation.muted} className="me-1" />
            ) : null}
          </div>
        </div>
      </div>

      {menu && (
        <Menu
          anchor={menu}
          items={items}
          label={t.more}
          onClose={() => setMenu(null)}
          onEscape={() => rowRef.current?.focus()}
        />
      )}
    </>
  )
}
