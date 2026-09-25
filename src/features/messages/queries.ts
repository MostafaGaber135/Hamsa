import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import type { CachedMessage, Conversation } from '@/types/chat'
import { privacyKeys } from '@/features/privacy/queries'
import { conversationKeys } from '../conversations/queries'
import { PAGE_SIZE, fetchMessagePage, insertMessage, withMediaUrls } from './api'

type Pages = InfiniteData<CachedMessage[], string | undefined>

export const messageKeys = {
  list: (conversationId: string) => ['messages', conversationId] as const,
}

/**
 * Messages of one conversation, newest page first. Each page is oldest→newest,
 * so the thread renders pages reversed and flattened.
 */
export function useMessages(conversationId: string, clearedAt?: string) {
  return useInfiniteQuery({
    queryKey: messageKeys.list(conversationId),
    queryFn: ({ pageParam }) => fetchMessagePage(conversationId, pageParam, clearedAt),
    initialPageParam: undefined as string | undefined,
    // A full page means there may be older messages: continue from the oldest one we have.
    getNextPageParam: (lastPage) => (lastPage.length === PAGE_SIZE ? lastPage[0].createdAt : undefined),
    select: (data) => data.pages.toReversed().flat(),
  })
}

export function patchMessage(qc: QueryClient, conversationId: string, id: string, patch: Partial<CachedMessage>) {
  qc.setQueryData<Pages>(messageKeys.list(conversationId), (data) =>
    data && {
      ...data,
      pages: data.pages.map((page) => page.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    },
  )
}

/** Adds the message to the newest page, or updates it in place if it's already there (a retry or an echo). */
export function upsertMessage(qc: QueryClient, conversationId: string, message: CachedMessage) {
  qc.setQueryData<Pages>(messageKeys.list(conversationId), (data) => {
    if (!data) return data
    const exists = data.pages.some((page) => page.some((m) => m.id === message.id))
    if (exists) {
      // Merge, so a Realtime echo of your own message keeps its local image preview.
      return { ...data, pages: data.pages.map((page) => page.map((m) => (m.id === message.id ? { ...m, ...message } : m))) }
    }
    const [newest = [], ...older] = data.pages
    return { ...data, pages: [[...newest, message], ...older] }
  })
}

/** Moves the conversation to the top of the list with the new preview. */
export function bumpConversation(qc: QueryClient, message: CachedMessage) {
  qc.setQueryData<Conversation[]>(conversationKeys.all, (list) => {
    if (!list) return list
    const target = list.find((c) => c.id === message.conversationId)
    if (!target) return list
    const updated = { ...target, lastMessage: message }
    const rest = list.filter((c) => c !== target)
    // A new message moves the chat to the top, but never above your pinned chats.
    const pinned = rest.filter((c) => c.pinned)
    const others = rest.filter((c) => !c.pinned)
    return target.pinned ? [updated, ...pinned, ...others] : [...pinned, updated, ...others]
  })
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (message: CachedMessage) =>
      insertMessage({
        id: message.id,
        conversationId,
        kind: message.kind,
        content: message.content,
        file: message.file,
        attachment: message.attachment,
      }),

    // Runs before the request: the message shows up instantly as "sending".
    onMutate: async (message) => {
      await qc.cancelQueries({ queryKey: messageKeys.list(conversationId) })
      const optimistic = { ...message, pending: 'sending' as const }
      upsertMessage(qc, conversationId, optimistic)
      bumpConversation(qc, optimistic)
    },

    onSuccess: async (saved, message) => {
      patchMessage(qc, conversationId, message.id, { pending: undefined, file: undefined })
      if (!message.file) return
      // Swap the local preview for the uploaded file, then free the preview's memory.
      const [uploaded] = await withMediaUrls([
        { ...message, ...saved, imageUrl: undefined, fileUrl: undefined },
      ]).catch(() => [undefined])
      if (!uploaded) return
      patchMessage(qc, conversationId, message.id, {
        imagePath: uploaded.imagePath,
        attachment: uploaded.attachment,
        imageUrl: uploaded.imageUrl,
        fileUrl: uploaded.fileUrl,
      })
      for (const url of [message.imageUrl, message.fileUrl]) if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    },

    // Failed messages stay where they are, marked failed, with a retry button.
    // The other person may have just blocked you: check, so the chat can say so.
    onError: (_error, message) => {
      patchMessage(qc, conversationId, message.id, { pending: 'failed' })
      qc.invalidateQueries({ queryKey: privacyKeys.blockedConversations })
    },

    onSettled: () => qc.invalidateQueries({ queryKey: conversationKeys.all }),
  })
}
