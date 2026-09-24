import { supabase } from '@/lib/supabase'
import type { Friendship } from '@/types/chat'

export async function fetchFriendships(): Promise<Friendship[]> {
  const { data, error } = await supabase.rpc('get_my_friendships')
  if (error) throw error

  return data.map((row) => ({
    user: {
      id: row.user_id,
      name: row.full_name,
      username: row.username,
      avatarUrl: row.avatar_url,
      online: false,
    },
    status: row.status === 'accepted' ? 'friends' : (row.direction as 'incoming' | 'outgoing'),
    since: row.created_at,
  }))
}

/** Returns 'pending', or 'accepted' if they had already sent you a request. */
export async function sendFriendRequest(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_friend_request', { target_id: userId })
  if (error) throw error
  return data
}

export async function respondToRequest(userId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_friend_request', { requester: userId, accept })
  if (error) throw error
}

/** Removes a friend, or cancels a request you sent. */
export async function removeFriendship(userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_friendship', { other_user_id: userId })
  if (error) throw error
}
