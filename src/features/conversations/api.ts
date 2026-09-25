import { supabase } from '@/lib/supabase'
import { AVATAR_SIZE, resizeImage, extensionFor } from '@/lib/image'
import type { Attachment, Conversation, ConversationAction, Member, Message, MessageKind, User } from '@/types/chat'

// ---------- mapping database rows → UI shapes ----------

interface MemberJson {
  id: string
  username: string
  full_name: string
  avatar_url: string | null
  // null when they hide it (or you no longer share a chat).
  last_seen_at: string | null
  last_read_at: string
  role: 'member' | 'admin'
}

type LastMessageJson = MessageRowLike

interface AttachmentJson {
  path?: string
  name?: string
  size?: number
  mime?: string
  duration_ms?: number
  waveform?: number[]
  lat?: number
  lng?: number
}

export interface MessageRowLike {
  id: string
  conversation_id?: string
  sender_id: string
  content: string | null
  image_path: string | null
  created_at: string
  kind?: string | null
  attachment?: unknown
  reply_to_id?: string | null
  edited_at?: string | null
  deleted_at?: string | null
  pinned_at?: string | null
  mentions?: string[] | null
  message_reactions?: { user_id: string; emoji: string }[] | null
}

const MAX_WAVEFORM_BARS = 64
/** Waveform bars are loudness percentages. */
const WAVEFORM_MAX = 100
const MAX_LATITUDE = 90
const MAX_LONGITUDE = 180

// Attachments come from other people's clients, so every field is checked:
// a wrong type is dropped instead of crashing the message that shows it.
const asString = (v: unknown) => (typeof v === 'string' ? v : undefined)
const asNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const inRange = (v: unknown, limit: number) => {
  const n = asNumber(v)
  return n !== undefined && Math.abs(n) <= limit ? n : undefined
}

export function toAttachment(json: unknown): Attachment | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined
  const a = json as Record<keyof AttachmentJson, unknown>
  const waveform = Array.isArray(a.waveform)
    ? a.waveform.slice(0, MAX_WAVEFORM_BARS).map((bar) => Math.min(WAVEFORM_MAX, Math.max(0, asNumber(bar) ?? 0)))
    : undefined
  return {
    path: asString(a.path),
    name: asString(a.name),
    size: asNumber(a.size),
    mime: asString(a.mime),
    durationMs: asNumber(a.duration_ms),
    waveform,
    lat: inRange(a.lat, MAX_LATITUDE),
    lng: inRange(a.lng, MAX_LONGITUDE),
  }
}

export function fromAttachment(a: Attachment): Record<string, string | number | number[]> {
  const json: Record<string, string | number | number[] | undefined> = {
    path: a.path,
    name: a.name,
    size: a.size,
    mime: a.mime,
    duration_ms: a.durationMs,
    waveform: a.waveform,
    lat: a.lat,
    lng: a.lng,
  }
  return Object.fromEntries(Object.entries(json).filter(([, v]) => v !== undefined)) as Record<
    string,
    string | number | number[]
  >
}

export function toMessage(row: MessageRowLike, conversationId?: string): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id ?? conversationId ?? '',
    senderId: row.sender_id,
    kind: (row.kind ?? (row.image_path ? 'image' : 'text')) as MessageKind,
    content: row.content ?? undefined,
    imagePath: row.image_path ?? undefined,
    attachment: toAttachment(row.attachment),
    createdAt: row.created_at,
    replyToId: row.reply_to_id ?? undefined,
    editedAt: row.edited_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    pinnedAt: row.pinned_at ?? undefined,
    mentions: row.mentions ?? undefined,
    // Only present when the query asked for them (message pages do).
    reactions: row.message_reactions?.map((r) => ({ userId: r.user_id, emoji: r.emoji })),
  }
}

// ---------- queries ----------

export async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase.rpc('get_my_conversations')
  if (error) throw error

  return data.map((row) => {
    const members: Member[] = ((row.members ?? []) as unknown as MemberJson[]).map((m) => ({
      id: m.id,
      name: m.full_name,
      username: m.username,
      avatarUrl: m.avatar_url,
      online: false,
      lastSeenAt: m.last_seen_at ?? undefined,
      lastReadAt: m.last_read_at,
      role: m.role,
    }))
    const last = row.last_message as unknown as LastMessageJson | null

    return {
      id: row.id,
      isGroup: row.is_group,
      name: row.name ?? undefined,
      members,
      memberIds: members.map((m) => m.id),
      unreadCount: row.unread_count,
      muted: row.muted,
      lastReadAt: row.last_read_at,
      lastMessage: last ? toMessage(last, row.id) : undefined,
      pinned: row.pinned_at !== null,
      markedUnread: row.marked_unread,
      clearedAt: row.cleared_at ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      wallpaper: row.wallpaper ?? undefined,
      myRole: row.my_role === 'admin' ? 'admin' : 'member',
      isRequest: row.is_request,
      description: row.description ?? undefined,
      inviteCode: row.invite_code ?? undefined,
    }
  })
}

export async function fetchProfile(userId: string): Promise<User> {
  const { data, error } = await supabase
    .from('profiles')
    // last_seen_at isn't readable directly: it's shared through get_my_conversations.
    .select('id, username, full_name, avatar_url')
    .eq('id', userId)
    .single()
  if (error) throw error
  return {
    id: data.id,
    name: data.full_name,
    username: data.username,
    avatarUrl: data.avatar_url,
    online: true,
  }
}

// ---------- mutations ----------

export async function openDirectConversation(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', { other_user_id: otherUserId })
  if (error) throw error
  return data
}

export async function createGroup(name: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_conversation', {
    group_name: name,
    member_ids: memberIds,
  })
  if (error) throw error
  return data
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', {
    conv_id: conversationId,
  })
  if (error) throw error
}

/** Every action in the conversation "more" menu. Each one changes only your own settings. */
export async function runConversationAction(conversationId: string, action: ConversationAction) {
  const conv_id = conversationId
  const { error } = await (() => {
    switch (action) {
      case 'pin':
        return supabase.rpc('set_conversation_pinned', {
          conv_id,
          pinned: true,
        })
      case 'unpin':
        return supabase.rpc('set_conversation_pinned', {
          conv_id,
          pinned: false,
        })
      case 'mute':
        return supabase.rpc('set_conversation_muted', {
          conv_id,
          is_muted: true,
        })
      case 'unmute':
        return supabase.rpc('set_conversation_muted', {
          conv_id,
          is_muted: false,
        })
      case 'markRead':
        return supabase.rpc('mark_conversation_read', { conv_id })
      case 'markUnread':
        return supabase.rpc('mark_conversation_unread', { conv_id })
      case 'delete':
        return supabase.rpc('clear_conversation', { conv_id })
      case 'leave':
        return supabase.rpc('leave_conversation', { conv_id })
      case 'accept':
        return supabase.rpc('accept_message_request', { conv_id })
    }
  })()
  if (error) throw error
}

// ---------- groups and per-chat settings ----------

export async function setWallpaper(conversationId: string, wallpaper: string) {
  const { error } = await supabase.rpc('set_conversation_wallpaper', {
    conv_id: conversationId,
    new_wallpaper: wallpaper,
  })
  if (error) throw error
}

export async function updateGroup(conversationId: string, name: string, avatarUrl: string | null) {
  const { error } = await supabase.rpc('update_group', {
    conv_id: conversationId,
    new_name: name,
    new_avatar_url: avatarUrl,
  })
  if (error) throw error
}

export async function setGroupDescription(conversationId: string, description: string) {
  const { error } = await supabase.rpc('set_group_description', {
    conv_id: conversationId,
    new_description: description,
  })
  if (error) throw error
}

/** Creates a new invite link (the old one stops working), or turns it off. Returns the code. */
export async function setGroupInvite(conversationId: string, enabled: boolean): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_group_invite', {
    conv_id: conversationId,
    enabled,
  })
  if (error) throw error
  return data
}

interface GroupInvite {
  conversationId: string
  name: string
  avatarUrl: string | null
  description: string | null
  memberCount: number
  alreadyMember: boolean
}

/** What an invite link leads to, or null if it doesn't work any more. */
export async function fetchGroupInvite(code: string): Promise<GroupInvite | null> {
  const { data, error } = await supabase.rpc('get_group_invite', { code })
  if (error) throw error
  const row = data[0]
  return row
    ? {
        conversationId: row.conversation_id,
        name: row.name,
        avatarUrl: row.avatar_url,
        description: row.description,
        memberCount: row.member_count,
        alreadyMember: row.already_member,
      }
    : null
}

export async function joinGroupByInvite(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_group_by_invite', { code })
  if (error) throw error
  return data
}

export async function uploadGroupPhoto(conversationId: string, file: File): Promise<string> {
  const blob = await resizeImage(file, { maxSide: AVATAR_SIZE, square: true })
  const path = `groups/${conversationId}/${Date.now()}.${extensionFor(blob)}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
  if (error) throw error
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

export async function addGroupMembers(conversationId: string, memberIds: string[]) {
  const { error } = await supabase.rpc('add_group_members', {
    conv_id: conversationId,
    member_ids: memberIds,
  })
  if (error) throw error
}

export async function removeGroupMember(conversationId: string, memberId: string) {
  const { error } = await supabase.rpc('remove_group_member', {
    conv_id: conversationId,
    member_id: memberId,
  })
  if (error) throw error
}

export async function setMemberRole(conversationId: string, memberId: string, role: 'member' | 'admin') {
  const { error } = await supabase.rpc('set_member_role', {
    conv_id: conversationId,
    member_id: memberId,
    new_role: role,
  })
  if (error) throw error
}
