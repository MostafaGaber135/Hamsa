import { createContext, useContext } from 'react'
import type { MenuAnchor } from '@/components/ui/Menu'
import type { Message, User } from '@/types/chat'

/** What every bubble in a thread needs to know, and the actions it can start. */
export interface ThreadContextValue {
  currentUserId: string
  users: Record<string, User>
  /** Members' usernames, for highlighting @mentions. */
  usernames: ReadonlySet<string>
  savedIds: ReadonlySet<string>
  /** Loaded messages by id, for showing what a reply quotes. */
  byId: ReadonlyMap<string, Message>
  /** Briefly highlighted after jumping to it. */
  highlightedId?: string
  onOpenMenu: (message: Message, anchor: MenuAnchor) => void
  onReact: (message: Message, emoji: string | null) => void
  onJump: (messageId: string) => void
  onCancelUpload: (messageId: string) => void
}

export const ThreadContext = createContext<ThreadContextValue | null>(null)

export function useThread() {
  const value = useContext(ThreadContext)
  if (!value) throw new Error('useThread must be used inside <ThreadContext>')
  return value
}
