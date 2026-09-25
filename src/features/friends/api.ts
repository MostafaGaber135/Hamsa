import { supabase } from '@/lib/supabase'
import type { Friendship, User } from '@/types/chat'

/** A username search needs at least this many characters (the server finds nobody with fewer). */
export const MIN_SEARCH_CHARS = 3

/** Someone your friends know, and how many of your friends know them. */
export interface Suggestion {
  user: User
  mutualFriends: number
}

interface PersonRow {
  id: string
  username: string
  full_name: string
  avatar_url: string | null
}

const toUser = (row: PersonRow): User => ({
  id: row.id,
  name: row.full_name,
  username: row.username,
  avatarUrl: row.avatar_url,
  online: false,
})

/** What was typed, as the server compares it: no spaces, no leading "@". */
export const toHandle = (query: string) => query.trim().replace(/^@/, '').toLowerCase()

/** People whose username starts with what you typed; nobody for fewer than MIN_SEARCH_CHARS characters. */
export async function searchPeople(query: string): Promise<User[]> {
  const handle = toHandle(query)
  if (handle.length < MIN_SEARCH_CHARS) return []
  const { data, error } = await supabase.rpc('search_people', { handle })
  if (error) throw error
  return data.map(toUser)
}

/** Friends of your friends you haven't added yet, most mutual friends first. */
export async function fetchSuggestions(): Promise<Suggestion[]> {
  const { data, error } = await supabase.rpc('people_you_may_know')
  if (error) throw error
  return data.map((row) => ({ user: toUser(row), mutualFriends: row.mutual_friends }))
}

export async function fetchFriendships(): Promise<Friendship[]> {
  const { data, error } = await supabase.rpc('get_my_friendships')
  if (error) throw error

  return data.map((row) => ({
    user: toUser({ ...row, id: row.user_id }),
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
