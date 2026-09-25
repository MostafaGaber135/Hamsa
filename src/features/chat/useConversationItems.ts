import { useMemo } from 'react'
import type { ConversationItem } from '@/features/conversations/ConversationList'
import type { Filter } from '@/features/conversations/Sidebar'
import { useMessageSearch } from '@/features/messages/queries'
import { withStatus } from '@/lib/status'
import { useDebounced } from '@/lib/useDebounced'
import type { Conversation, User } from '@/types/chat'

/** Message search waits until you stop typing for this long. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The sidebar's contents: the chats that match the filter and search, message search
 * results (from two characters on), and the unread and request counts.
 */
export function useConversationItems(
  conversations: Conversation[],
  me: User,
  users: Record<string, User>,
  query: string,
  filter: Filter,
) {
  const items = useMemo<ConversationItem[]>(() => {
    const q = query.trim().toLocaleLowerCase()
    return (
      conversations
        .map((c) => {
          const peer = c.isGroup ? undefined : c.members.find((m) => m.id !== me.id)
          const lastMessage = c.lastMessage && withStatus(c.lastMessage, me.id, c.members)
          return {
            conversation: c,
            title: c.name ?? peer?.name ?? '',
            peer,
            lastMessage,
            lastSender: lastMessage && users[lastMessage.senderId],
          }
        })
        // Message requests live in their own tab.
        .filter((it) => (filter === 'requests') === it.conversation.isRequest)
        .filter((it) => filter !== 'unread' || it.conversation.unreadCount > 0 || it.conversation.markedUnread)
        .filter((it) => filter !== 'groups' || it.conversation.isGroup)
        .filter((it) => it.title.toLocaleLowerCase().includes(q))
    )
  }, [conversations, me.id, users, query, filter])

  // Message search, alongside the chat names, once you've typed two characters.
  const searchQuery = useDebounced(query, SEARCH_DEBOUNCE_MS)
  const messageSearch = useMessageSearch(searchQuery)
  const messageResults = useMemo(() => {
    if (searchQuery.trim().length < 2) return undefined
    const titles = new Map(
      conversations.map((c) => [c.id, c.name ?? c.members.find((m) => m.id !== me.id)?.name ?? '']),
    )
    return (messageSearch.data ?? []).map((r) => ({ ...r, title: titles.get(r.conversationId) ?? '' }))
  }, [searchQuery, messageSearch.data, conversations, me.id])

  const unreadTotal = conversations.filter((c) => !c.isRequest && (c.unreadCount > 0 || c.markedUnread)).length
  const requestCount = conversations.filter((c) => c.isRequest).length

  return { items, messageResults, searchingMessages: messageSearch.isFetching, unreadTotal, requestCount }
}
