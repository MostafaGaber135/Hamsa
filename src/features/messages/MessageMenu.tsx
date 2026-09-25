import { Copy, Flag, Info, Pencil, Pin, PinOff, Reply, SmilePlus, Star, StarOff, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dialog } from '@/components/ui/Dialog'
import { Menu, type MenuAnchor, type MenuItem } from '@/components/ui/Menu'
import { ReportDialog } from '@/features/privacy/ReportDialog'
import { useLocale } from '@/lib/i18n'
import type { Conversation, Message, User } from '@/types/chat'
import { ReactionBar } from './ReactionBar'

/** The same limits as the database (edit_message and delete_message). */
const EDIT_WINDOW_MS = 15 * 60 * 1000
const DELETE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface MessageMenuState {
  message: Message
  anchor: MenuAnchor
}

interface MessageMenuProps {
  state: MessageMenuState
  conversation: Conversation
  currentUserId: string
  users: Record<string, User>
  saved: boolean
  onClose: () => void
  onReply: (message: Message) => void
  onEdit: (message: Message) => void
  onDelete: (message: Message) => void
  onReact: (message: Message, emoji: string | null) => void
  onPin: (message: Message, pinned: boolean) => void
  onSave: (message: Message, saved: boolean) => void
}

/** 'closing': the menu asked to close; unless an item opened a panel meanwhile, it closes. */
type Panel = 'menu' | 'closing' | 'react' | 'info' | 'report'

/** Everything you can do with one message, offered only when it's allowed. */
export function MessageMenu({
  state, conversation, currentUserId, users, saved, onClose, onReply, onEdit, onDelete, onReact, onPin, onSave,
}: MessageMenuProps) {
  const { t } = useLocale()
  const [panel, setPanel] = useState<Panel>('menu')
  // Captured once, when the menu opens: are edit and delete still allowed?
  const [openedAt] = useState(() => Date.now())
  // Menu closes itself before running the picked item. Both are state updates, so if the
  // item opens a panel, that wins; otherwise the "closing" state closes everything.
  useEffect(() => {
    if (panel === 'closing') onClose()
  }, [panel, onClose])
  const openPanel = (next: Panel) => setPanel(next)
  const { message, anchor } = state
  const own = message.senderId === currentUserId
  const age = openedAt - Date.parse(message.createdAt)
  const text = message.kind !== 'sticker' ? message.content : undefined
  const canPin = !conversation.isGroup || conversation.myRole === 'admin'
  const myReaction = message.reactions?.find((r) => r.userId === currentUserId)?.emoji
  const icon = { size: 18, strokeWidth: 1.75 }

  const items: MenuItem[] = [
    { id: 'reply', label: t.msg.reply, icon: <Reply {...icon} className="rtl:-scale-x-100" />, onSelect: () => onReply(message) },
    { id: 'react', label: t.msg.react, icon: <SmilePlus {...icon} />, onSelect: () => openPanel('react') },
  ]
  if (text) {
    items.push({ id: 'copy', label: t.msg.copy, icon: <Copy {...icon} />, onSelect: () => void navigator.clipboard?.writeText(text) })
  }
  if (own && message.kind === 'text' && age < EDIT_WINDOW_MS) {
    items.push({ id: 'edit', label: t.msg.edit, icon: <Pencil {...icon} />, onSelect: () => onEdit(message) })
  }
  if (canPin) {
    items.push(
      message.pinnedAt
        ? { id: 'unpin', label: t.msg.unpin, icon: <PinOff {...icon} />, onSelect: () => onPin(message, false) }
        : { id: 'pin', label: t.msg.pin, icon: <Pin {...icon} />, onSelect: () => onPin(message, true) },
    )
  }
  items.push(
    saved
      ? { id: 'unsave', label: t.msg.unsave, icon: <StarOff {...icon} />, onSelect: () => onSave(message, false) }
      : { id: 'save', label: t.msg.save, icon: <Star {...icon} />, onSelect: () => onSave(message, true) },
  )
  if (own && conversation.isGroup) {
    items.push({ id: 'info', label: t.msg.info, icon: <Info {...icon} />, onSelect: () => openPanel('info') })
  }
  if (own && age < DELETE_WINDOW_MS) {
    items.push({
      id: 'delete',
      label: t.msg.delete,
      danger: true,
      icon: <Trash2 {...icon} />,
      onSelect: () => window.confirm(t.msg.deleteConfirm) && onDelete(message),
    })
  }
  if (!own) {
    items.push({ id: 'report', label: t.msg.report, danger: true, icon: <Flag {...icon} />, onSelect: () => openPanel('report') })
  }

  if (panel === 'react') {
    return <ReactionBar anchor={anchor} current={myReaction} onPick={(emoji) => onReact(message, emoji)} onClose={onClose} />
  }
  if (panel === 'info') return <ReadByDialog message={message} conversation={conversation} currentUserId={currentUserId} onClose={onClose} />
  if (panel === 'report') {
    const sender = users[message.senderId]
    return sender ? <ReportDialog user={sender} messageId={message.id} onClose={onClose} /> : null
  }
  return (
    <Menu
      anchor={anchor}
      label={t.msg.actions}
      items={items}
      onClose={() => setPanel('closing')}
    />
  )
}

/** Who in a group has read your message: everyone whose read marker passed it. */
function ReadByDialog({ message, conversation, currentUserId, onClose }: {
  message: Message
  conversation: Conversation
  currentUserId: string
  onClose: () => void
}) {
  const { t, fmt } = useLocale()
  const sentAt = Date.parse(message.createdAt)
  const others = conversation.members.filter((m) => m.id !== currentUserId)
  const read = others.filter((m) => Date.parse(m.lastReadAt) >= sentAt)
  const unread = others.filter((m) => Date.parse(m.lastReadAt) < sentAt)

  const list = (people: typeof others) => (
    <ul className="mt-2 flex flex-col gap-1">
      {people.map((m) => (
        <li key={m.id} className="flex items-center gap-3 py-1">
          <Avatar id={m.id} name={m.name} src={m.avatarUrl} size="sm" />
          <span dir="auto" className="min-w-0 flex-1 truncate text-body">{m.name}</span>
        </li>
      ))}
    </ul>
  )

  return (
    <Dialog title={t.info.title} closeLabel={t.info.close} onClose={onClose}>
      <p className="text-caption text-ink-muted">
        {fmt.day(message.createdAt)} · {fmt.time(message.createdAt)}
      </p>
      <section className="mt-4">
        <h3 className="text-body font-semibold">{t.info.readBy}</h3>
        {read.length ? list(read) : <p className="mt-1 text-body text-ink-muted">{t.info.nobody}</p>}
      </section>
      {unread.length > 0 && (
        <section className="mt-4">
          <h3 className="text-body font-semibold">{t.info.notYet}</h3>
          {list(unread)}
        </section>
      )}
      {unread.length === 0 && read.length > 0 && <p className="mt-3 text-caption text-ink-muted">{t.info.everyone}</p>}
    </Dialog>
  )
}
