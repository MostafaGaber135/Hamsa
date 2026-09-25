import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Friendship, FriendStatus, User } from '@/types/chat'
import { fetchFriendships, removeFriendship, respondToRequest, sendFriendRequest } from './api'

export const friendKeys = {
  all: ['friendships'] as const,
}

export function useFriendships() {
  return useQuery({ queryKey: friendKeys.all, queryFn: fetchFriendships })
}

type Action =
  | { type: 'add'; user: User }
  | { type: 'accept'; user: User }
  | { type: 'decline'; user: User }
  | { type: 'remove'; user: User }

async function run(action: Action) {
  switch (action.type) {
    case 'add':
      return sendFriendRequest(action.user.id)
    case 'accept':
      return respondToRequest(action.user.id, true)
    case 'decline':
      return respondToRequest(action.user.id, false)
    case 'remove':
      return removeFriendship(action.user.id)
  }
}

/**
 * One mutation for every friend action. The list updates instantly (optimistic),
 * then refetches from the server to pick up the real result.
 */
export function useFriendAction() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: run,
    onMutate: async (action) => {
      await qc.cancelQueries({ queryKey: friendKeys.all })
      const previous = qc.getQueryData<Friendship[]>(friendKeys.all)

      qc.setQueryData<Friendship[]>(friendKeys.all, (list = []) => {
        const others = list.filter((f) => f.user.id !== action.user.id)
        const next: FriendStatus | null =
          action.type === 'add' ? 'outgoing' : action.type === 'accept' ? 'friends' : null
        return next ? [...others, { user: action.user, status: next, since: new Date().toISOString() }] : others
      })

      return { previous }
    },
    onError: (_error, _action, context) => {
      if (context?.previous) qc.setQueryData(friendKeys.all, context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: friendKeys.all }),
  })
}
