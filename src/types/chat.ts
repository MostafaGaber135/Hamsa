// The shapes the UI works with. api.ts files map database rows into these.

export type MessageStatus = 'sending' | 'sent' | 'read' | 'failed'

export interface User {
  id: string
  name: string
  username?: string
  avatarUrl?: string | null
  /** From Realtime Presence. */
  online: boolean
  lastSeenAt?: string
}

export interface Member extends User {
  lastReadAt: string
  role: 'member' | 'admin'
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  content?: string
  /** Where the image lives in the chat-images bucket. */
  imagePath?: string
  /** A URL the browser can show: a signed URL, or a local preview while sending. */
  imageUrl?: string
  createdAt: string
  /** Only on your own messages. Derived from members' lastReadAt, or local while sending. */
  status?: MessageStatus
}

/** A message that exists only in the cache until the server confirms it. */
export interface CachedMessage extends Message {
  pending?: 'sending' | 'failed'
  /** The picked image, kept until the upload succeeds so "retry" can upload it again. */
  imageFile?: File
}

export interface Conversation {
  id: string
  isGroup: boolean
  /** Group name. 1:1 conversations use the other member's name. */
  name?: string
  memberIds: string[]
  members: Member[]
  unreadCount: number
  muted?: boolean
  lastReadAt?: string
  lastMessage?: Message
  /** From Realtime Broadcast. */
  typingUserIds?: string[]
  pinned?: boolean
  /** You chose "Mark as unread": shows a dot until you open it. */
  markedUnread?: boolean
  /** You deleted the chat at this moment: older messages are hidden for you. */
  clearedAt?: string
}

export type ConversationAction = 'pin' | 'unpin' | 'mute' | 'unmute' | 'markRead' | 'markUnread' | 'delete' | 'leave'

export type FriendStatus = 'friends' | 'incoming' | 'outgoing'

/** Someone you're friends with, or have a pending request with. */
export interface Friendship {
  user: User
  status: FriendStatus
  since: string
}
