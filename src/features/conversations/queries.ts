import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Conversation, ConversationAction } from '@/types/chat'
import {
  addGroupMembers,
  fetchConversations,
  fetchProfile,
  markConversationRead,
  removeGroupMember,
  runConversationAction,
  searchProfiles,
  setGroupDescription,
  setGroupInvite,
  setMemberRole,
  setWallpaper,
  updateGroup,
  uploadGroupPhoto,
} from './api'

export const conversationKeys = {
  all: ['conversations'] as const,
  profile: (id: string) => ['profile', id] as const,
  search: (q: string) => ['profiles', 'search', q] as const,
}

export function useConversations() {
  return useQuery({ queryKey: conversationKeys.all, queryFn: fetchConversations })
}

export function useProfile(userId: string) {
  return useQuery({ queryKey: conversationKeys.profile(userId), queryFn: () => fetchProfile(userId) })
}

export function useProfileSearch(query: string, excludeId: string) {
  return useQuery({
    queryKey: conversationKeys.search(query),
    queryFn: () => searchProfiles(query, excludeId),
    enabled: query.trim().length > 0,
    staleTime: 60_000,
  })
}

/** Clears the badge immediately, then tells the server. */
export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markConversationRead,
    onMutate: (conversationId) => {
      queryClient.setQueryData<Conversation[]>(conversationKeys.all, (list) =>
        list?.map((c) =>
          c.id === conversationId
            ? { ...c, unreadCount: 0, markedUnread: false, lastReadAt: new Date().toISOString() }
            : c,
        ),
      )
    },
  })
}

/** Pinned conversations first; otherwise keep the order the list already has. */
function sortPinnedFirst(list: Conversation[]) {
  return [...list.filter((c) => c.pinned), ...list.filter((c) => !c.pinned)]
}

function applyAction(c: Conversation, action: ConversationAction): Conversation | null {
  switch (action) {
    case 'pin':
      return { ...c, pinned: true }
    case 'unpin':
      return { ...c, pinned: false }
    case 'mute':
      return { ...c, muted: true }
    case 'unmute':
      return { ...c, muted: false }
    case 'markRead':
      return { ...c, unreadCount: 0, markedUnread: false }
    case 'markUnread':
      return { ...c, markedUnread: true }
    case 'accept':
      return { ...c, isRequest: false }
    case 'delete':
    case 'leave':
      return null
  }
}

/** The "more" menu actions, applied to the list instantly and rolled back if the server says no. */
export function useConversationAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: ConversationAction }) => runConversationAction(id, action),
    onMutate: async ({ id, action }) => {
      await qc.cancelQueries({ queryKey: conversationKeys.all })
      const previous = qc.getQueryData<Conversation[]>(conversationKeys.all)
      qc.setQueryData<Conversation[]>(conversationKeys.all, (list) => {
        if (!list) return list
        const next = list.flatMap((c) => (c.id === id ? (applyAction(c, action) ?? []) : [c]))
        return action === 'pin' || action === 'unpin' ? sortPinnedFirst(next) : next
      })
      if (action === 'delete' || action === 'leave') qc.removeQueries({ queryKey: ['messages', id] })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(conversationKeys.all, context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: conversationKeys.all }),
  })
}

/** Your background for one chat, applied instantly. */
export function useSetWallpaper() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, wallpaper }: { id: string; wallpaper: string }) => setWallpaper(id, wallpaper),
    onMutate: ({ id, wallpaper }) => {
      qc.setQueryData<Conversation[]>(conversationKeys.all, (list) =>
        list?.map((c) => (c.id === id ? { ...c, wallpaper: wallpaper === 'default' ? undefined : wallpaper } : c)),
      )
    },
    onSettled: () => qc.invalidateQueries({ queryKey: conversationKeys.all }),
  })
}

/** Group settings for admins: name and photo, members and roles. */
export function useGroupAdmin(conversationId: string) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: conversationKeys.all })

  const update = useMutation({
    mutationFn: async ({
      name,
      photo,
      avatarUrl,
      description,
    }: {
      name: string
      photo?: File
      avatarUrl: string | null
      /** Only sent when it changed. */
      description?: string
    }) => {
      const url = photo ? await uploadGroupPhoto(conversationId, photo) : avatarUrl
      await updateGroup(conversationId, name, url)
      if (description !== undefined) await setGroupDescription(conversationId, description)
    },
    onSettled: refresh,
  })
  const invite = useMutation({
    mutationFn: (enabled: boolean) => setGroupInvite(conversationId, enabled),
    onSettled: refresh,
  })
  const add = useMutation({ mutationFn: (ids: string[]) => addGroupMembers(conversationId, ids), onSettled: refresh })
  const remove = useMutation({ mutationFn: (id: string) => removeGroupMember(conversationId, id), onSettled: refresh })
  const role = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'member' | 'admin' }) => setMemberRole(conversationId, id, role),
    onSettled: refresh,
  })
  return { update, add, remove, role, invite }
}
