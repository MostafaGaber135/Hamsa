import { supabase } from '@/lib/supabase'
import type { User } from '@/types/chat'

/** Who may put you in a group: anyone, or only your friends. */
export type GroupInvites = 'everyone' | 'friends'

/** The people you blocked. */
export async function fetchBlocks(): Promise<User[]> {
  const { data, error } = await supabase.rpc('get_my_blocks')
  if (error) throw error
  return data.map((row) => ({
    id: row.user_id,
    name: row.full_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    online: false,
  }))
}

/** Your one-to-one chats where either of you blocked the other. */
export async function fetchBlockedConversationIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_blocked_conversations')
  if (error) throw error
  return data
}

export async function setBlocked(userId: string, blocked: boolean) {
  const { error } = blocked
    ? await supabase.rpc('block_user', { target_id: userId })
    : await supabase.rpc('unblock_user', { target_id: userId })
  if (error) throw error
}

export async function fetchGroupInvites(userId: string): Promise<GroupInvites> {
  const { data, error } = await supabase.from('profiles').select('group_invites').eq('id', userId).single()
  if (error) throw error
  return data.group_invites === 'friends' ? 'friends' : 'everyone'
}

export async function updateGroupInvites(userId: string, value: GroupInvites) {
  const { error } = await supabase.from('profiles').update({ group_invites: value }).eq('id', userId)
  if (error) throw error
}
