import { supabase } from '@/lib/supabase'
import type { User } from '@/types/chat'

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

/** Who sees when you're online and your "last seen": people you chat with, or nobody. */
type PresenceVisibility = 'contacts' | 'nobody'

export interface PrivacySettings {
  presence: PresenceVisibility
}

export async function fetchPrivacySettings(userId: string): Promise<PrivacySettings> {
  const { data, error } = await supabase.from('profiles').select('presence_visibility').eq('id', userId).single()
  if (error) throw error
  return {
    presence: data.presence_visibility === 'nobody' ? 'nobody' : 'contacts',
  }
}

export async function updatePrivacySettings(userId: string, changes: Partial<PrivacySettings>) {
  const { error } = await supabase.from('profiles').update({ presence_visibility: changes.presence }).eq('id', userId)
  if (error) throw error
}
