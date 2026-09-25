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

export type MessageKind = 'text' | 'image' | 'video' | 'voice' | 'file' | 'location' | 'sticker'

/** Details for voice notes, files, videos and locations. */
export interface Attachment {
  /** Where the file lives in the chat-files bucket. */
  path?: string
  name?: string
  size?: number
  mime?: string
  durationMs?: number
  /** Voice notes: loudness bars (0–100) recorded with the audio. */
  waveform?: number[]
  lat?: number
  lng?: number
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  kind: MessageKind
  /** Text, a caption, or a sticker id. */
  content?: string
  attachment?: Attachment
  /** A URL the browser can open for the attachment (signed, or local while sending). */
  fileUrl?: string
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
  /** The picked file or recording, kept until the upload succeeds so "retry" can upload it again. */
  file?: File
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
  /** Group photo. */
  avatarUrl?: string
  /** Your chosen background for this chat. */
  wallpaper?: string
  /** Your role in this conversation. Admins can edit a group. */
  myRole: 'member' | 'admin'
  /** A one-to-one chat a stranger started, waiting for you to accept or reply. */
  isRequest: boolean
}

export type ConversationAction =
  | 'pin' | 'unpin' | 'mute' | 'unmute' | 'markRead' | 'markUnread' | 'delete' | 'leave' | 'accept'

export type FriendStatus = 'friends' | 'incoming' | 'outgoing'

/** Someone you're friends with, or have a pending request with. */
export interface Friendship {
  user: User
  status: FriendStatus
  since: string
}
