import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Friendship, FriendStatus, User } from '@/types/chat'
import {
  MIN_SEARCH_CHARS,
  fetchFriendships,
  fetchSuggestions,
  removeFriendship,
  respondToRequest,
  searchPeople,
  sendFriendRequest,
  toHandle,
} from './api'

/** Search results and suggestions sit under the friendships key, so a friend action refreshes them too. */
const FRIENDSHIPS = ['friendships'] as const
export const friendKeys = {
  all: FRIENDSHIPS,
  search: (handle: string) => [...FRIENDSHIPS, 'search', handle] as const,
  suggestions: [...FRIENDSHIPS, 'suggestions'] as const,
}

/** Search results don't change much while you type. */
const SEARCH_STALE_MS = 60_000

export function useFriendships() {
  return useQuery({ queryKey: friendKeys.all, queryFn: fetchFriendships })
}

/** Just your friends: the people you can chat with and put in groups. */
export function useFriends() {
  return useQuery({
    queryKey: friendKeys.all,
    queryFn: fetchFriendships,
    select: (list): User[] => list.filter((f) => f.status === 'friends').map((f) => f.user),
  })
}

export function usePeopleSearch(query: string) {
  const handle = toHandle(query)
  return useQuery({
    queryKey: friendKeys.search(handle),
    queryFn: () => searchPeople(handle),
    enabled: handle.length >= MIN_SEARCH_CHARS,
    staleTime: SEARCH_STALE_MS,
  })
}

export function useSuggestions() {
  return useQuery({ queryKey: friendKeys.suggestions, queryFn: fetchSuggestions })
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
