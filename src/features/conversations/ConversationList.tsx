import { useRef, type KeyboardEvent } from 'react'
import { useLocale } from '@/lib/i18n'
import type { Conversation, ConversationAction, Message, User } from '@/types/chat'
import { ConversationRow } from './ConversationRow'

export interface ConversationItem {
  conversation: Conversation
  title: string
  peer?: User
  lastMessage?: Message
  lastSender?: User
}

interface ConversationListProps {
  items: ConversationItem[]
  selectedId: string | null
  currentUserId: string
  onSelect: (id: string) => void
  onAction: (id: string, action: ConversationAction) => void
}

/**
 * One tab stop for the whole list (roving tabindex), per the design system:
 * ↑/↓ move, Home/End jump, Enter opens, typing a letter jumps to the next matching name.
 */
export function ConversationList({ items, selectedId, currentUserId, onSelect, onAction }: ConversationListProps) {
  const { t } = useLocale()
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const selectedIndex = items.findIndex((it) => it.conversation.id === selectedId)
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0

  function focusRow(i: number) {
    const clamped = Math.max(0, Math.min(items.length - 1, i))
    rowRefs.current[clamped]?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = rowRefs.current.findIndex((el) => el === document.activeElement)
    if (current < 0) return

    switch (e.key) {
      case 'ArrowDown': focusRow(current + 1); break
      case 'ArrowUp': focusRow(current - 1); break
      case 'Home': focusRow(0); break
      case 'End': focusRow(items.length - 1); break
      case 'Enter':
      case ' ':
        onSelect(items[current].conversation.id)
        break
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
        const key = e.key.toLocaleLowerCase()
        const order = [...items.keys()].map((k) => (current + 1 + k) % items.length)
        const match = order.find((i) => items[i].title.toLocaleLowerCase().startsWith(key))
        if (match === undefined) return
        focusRow(match)
      }
    }
    e.preventDefault()
  }

  if (items.length === 0) {
    return <p className="px-4 py-8 text-center text-body text-ink-muted">{t.noResults}</p>
  }

  return (
    <div role="listbox" aria-label={t.conversations} onKeyDown={handleKeyDown} className="flex flex-col gap-0.5">
      {items.map((item, i) => (
        <ConversationRow
          key={item.conversation.id}
          ref={(el) => { rowRefs.current[i] = el }}
          {...item}
          currentUserId={currentUserId}
          selected={item.conversation.id === selectedId}
          tabIndex={i === tabStop ? 0 : -1}
          onSelect={() => onSelect(item.conversation.id)}
          onAction={(action) => onAction(item.conversation.id, action)}
        />
      ))}
    </div>
  )
}
