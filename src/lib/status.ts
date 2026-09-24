import type { CachedMessage, Member, Message } from '@/types/chat'

/**
 * Your own messages show one delivery state:
 * - "sending"/"failed" while it only exists locally
 * - "read" once every other member's lastReadAt has passed it
 * - "sent" otherwise
 */
export function withStatus(message: CachedMessage, currentUserId: string, members: Member[]): Message {
  if (message.senderId !== currentUserId) return message
  if (message.pending) return { ...message, status: message.pending }

  const sentAt = Date.parse(message.createdAt)
  const others = members.filter((m) => m.id !== currentUserId)
  const readByAll = others.length > 0 && others.every((m) => Date.parse(m.lastReadAt) >= sentAt)
  return { ...message, status: readByAll ? 'read' : 'sent' }
}
