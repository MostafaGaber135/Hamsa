import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { conversationKeys } from '@/features/conversations/queries'
import { friendKeys } from '@/features/friends/queries'
import {
  fetchBlockedConversationIds, fetchBlocks, fetchGroupInvites, setBlocked, updateGroupInvites, type GroupInvites,
} from './api'

export const privacyKeys = {
  /** Prefix for everything that changes when someone is blocked or unblocked. */
  blocks: ['blocks'] as const,
  blockedUsers: ['blocks', 'users'] as const,
  blockedConversations: ['blocks', 'conversations'] as const,
  groupInvites: (userId: string) => ['group-invites', userId] as const,
}

export function useBlockedUsers() {
  return useQuery({ queryKey: privacyKeys.blockedUsers, queryFn: fetchBlocks })
}

/**
 * Whether you can write in this chat: blocked "byMe" (you can unblock), blocked
 * "byThem", or undefined when nothing is blocked. Groups are never blocked.
 */
export function useBlockState(conversationId: string, peerId: string | undefined): 'byMe' | 'byThem' | undefined {
  const conversations = useQuery({ queryKey: privacyKeys.blockedConversations, queryFn: fetchBlockedConversationIds })
  const users = useBlockedUsers()
  if (!peerId || !conversations.data?.includes(conversationId)) return undefined
  return users.data?.some((u) => u.id === peerId) ? 'byMe' : 'byThem'
}

/** Blocking also ends a friendship, and changes which chats you can write in. */
export function useSetBlocked() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) => setBlocked(userId, blocked),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: privacyKeys.blocks }),
        qc.invalidateQueries({ queryKey: friendKeys.all }),
        qc.invalidateQueries({ queryKey: conversationKeys.all }),
      ]),
  })
}

export function useGroupInvites(userId: string) {
  return useQuery({ queryKey: privacyKeys.groupInvites(userId), queryFn: () => fetchGroupInvites(userId) })
}

/** Applied instantly, rolled back if the server says no. */
export function useSetGroupInvites(userId: string) {
  const qc = useQueryClient()
  const key = privacyKeys.groupInvites(userId)
  return useMutation({
    mutationFn: (value: GroupInvites) => updateGroupInvites(userId, value),
    onMutate: (value) => {
      const previous = qc.getQueryData<GroupInvites>(key)
      qc.setQueryData(key, value)
      return { previous }
    },
    onError: (_error, _value, context) => qc.setQueryData(key, context?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}
