import { supabase } from '@/lib/supabase'
import type { Attachment, Conversation, ConversationAction, Member, Message, MessageKind, User } from '@/types/chat'

// ---------- mapping database rows → UI shapes ----------

interface MemberJson {
  id: string
  username: string
  full_name: string
  avatar_url: string | null
  last_seen_at: string
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
}

export function toAttachment(json: unknown): Attachment | undefined {
  if (!json || typeof json !== 'object') return undefined
  const a = json as AttachmentJson
  return {
    path: a.path, name: a.name, size: a.size, mime: a.mime, durationMs: a.duration_ms,
    waveform: Array.isArray(a.waveform) ? a.waveform.slice(0, 64).map(Number) : undefined,
    lat: a.lat, lng: a.lng,
  }
}

export function fromAttachment(a: Attachment): Record<string, string | number | number[]> {
  const json: Record<string, string | number | number[] | undefined> = {
    path: a.path, name: a.name, size: a.size, mime: a.mime, duration_ms: a.durationMs,
    waveform: a.waveform, lat: a.lat, lng: a.lng,
  }
  return Object.fromEntries(Object.entries(json).filter(([, v]) => v !== undefined)) as Record<string, string | number | number[]>
}

export function toMessage(row: MessageRowLike, conversationId?: string): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id ?? conversationId ?? '',
    senderId: row.sender_id,
    kind: ((row.kind ?? (row.image_path ? 'image' : 'text')) as MessageKind),
    content: row.content ?? undefined,
    imagePath: row.image_path ?? undefined,
    attachment: toAttachment(row.attachment),
    createdAt: row.created_at,
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
      lastSeenAt: m.last_seen_at,
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
    }
  })
}

export async function fetchProfile(userId: string): Promise<User> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url, last_seen_at')
    .eq('id', userId)
    .single()
  if (error) throw error
  return {
    id: data.id,
    name: data.full_name,
    username: data.username,
    avatarUrl: data.avatar_url,
    online: true,
    lastSeenAt: data.last_seen_at,
  }
}

export async function searchProfiles(query: string, excludeId: string): Promise<User[]> {
  // Characters that have meaning inside PostgREST's or() filter are removed,
  // so a search for "a,b" can't change the shape of the query.
  const q = query.replace(/[%*,()\\"]/g, ' ').trim()
  if (!q) return []

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
    .neq('id', excludeId)
    .order('full_name')
    .limit(20)
  if (error) throw error

  return data.map((p) => ({ id: p.id, name: p.full_name, username: p.username, avatarUrl: p.avatar_url, online: false }))
}

// ---------- mutations ----------

export async function openDirectConversation(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', { other_user_id: otherUserId })
  if (error) throw error
  return data
}

export async function createGroup(name: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_conversation', { group_name: name, member_ids: memberIds })
  if (error) throw error
  return data
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', { conv_id: conversationId })
  if (error) throw error
}

/** Every action in the conversation "more" menu. Each one changes only your own settings. */
export async function runConversationAction(conversationId: string, action: ConversationAction) {
  const conv_id = conversationId
  const { error } = await (() => {
    switch (action) {
      case 'pin': return supabase.rpc('set_conversation_pinned', { conv_id, pinned: true })
      case 'unpin': return supabase.rpc('set_conversation_pinned', { conv_id, pinned: false })
      case 'mute': return supabase.rpc('set_conversation_muted', { conv_id, is_muted: true })
      case 'unmute': return supabase.rpc('set_conversation_muted', { conv_id, is_muted: false })
      case 'markRead': return supabase.rpc('mark_conversation_read', { conv_id })
      case 'markUnread': return supabase.rpc('mark_conversation_unread', { conv_id })
      case 'delete': return supabase.rpc('clear_conversation', { conv_id })
      case 'leave': return supabase.rpc('leave_conversation', { conv_id })
    }
  })()
  if (error) throw error
}

// ---------- groups and per-chat settings ----------

export async function setWallpaper(conversationId: string, wallpaper: string) {
  const { error } = await supabase.rpc('set_conversation_wallpaper', { conv_id: conversationId, new_wallpaper: wallpaper })
  if (error) throw error
}

export async function updateGroup(conversationId: string, name: string, avatarUrl: string | null) {
  const { error } = await supabase.rpc('update_group', { conv_id: conversationId, new_name: name, new_avatar_url: avatarUrl })
  if (error) throw error
}

export async function uploadGroupPhoto(conversationId: string, file: File): Promise<string> {
  const { resizeImage, extensionFor } = await import('@/lib/image')
  const blob = await resizeImage(file, { maxSide: 256, square: true })
  const path = `groups/${conversationId}/${Date.now()}.${extensionFor(blob)}`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
  if (error) throw error
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

export async function addGroupMembers(conversationId: string, memberIds: string[]) {
  const { error } = await supabase.rpc('add_group_members', { conv_id: conversationId, member_ids: memberIds })
  if (error) throw error
}

export async function removeGroupMember(conversationId: string, memberId: string) {
  const { error } = await supabase.rpc('remove_group_member', { conv_id: conversationId, member_id: memberId })
  if (error) throw error
}

export async function setMemberRole(conversationId: string, memberId: string, role: 'member' | 'admin') {
  const { error } = await supabase.rpc('set_member_role', { conv_id: conversationId, member_id: memberId, new_role: role })
  if (error) throw error
}
