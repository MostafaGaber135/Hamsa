import { supabase } from '@/lib/supabase'
import type { MessageKind, User } from '@/types/chat'

/** What happened. The database triggers are the only thing that creates these. */
type NotificationKind =
  'friend_request' | 'friend_accepted' | 'added_to_group' | 'made_admin' | 'reaction' | 'mention' | 'reply'

export interface AppNotification {
  id: string
  kind: NotificationKind
  createdAt: string
  read: boolean
  /** Who did it. */
  actor: User
  conversationId?: string
  /** Set when it happened in a group. */
  groupName?: string
  messageId?: string
  messageKind?: MessageKind
  /** The message's text; missing when it has none or was deleted. */
  messageText?: string
  messageDeleted: boolean
  emoji?: string
}

/** Your newest notifications first, with who did it and where. */
export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase.rpc('get_my_notifications')
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    kind: row.kind as NotificationKind,
    createdAt: row.created_at,
    read: row.read_at !== null,
    actor: {
      id: row.actor_id,
      name: row.actor_name,
      username: row.actor_username,
      avatarUrl: row.actor_avatar,
      online: false,
    },
    conversationId: row.conversation_id ?? undefined,
    groupName: row.group_name ?? undefined,
    messageId: row.message_id ?? undefined,
    messageKind: (row.message_kind as MessageKind | null) ?? undefined,
    messageText: row.message_text ?? undefined,
    messageDeleted: row.message_deleted === true,
    emoji: row.emoji ?? undefined,
  }))
}

/** Marks all of them read, on every device. */
export async function markNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read')
  if (error) throw error
}
