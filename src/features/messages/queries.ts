import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import type { CachedMessage, Conversation, Message, Reaction } from '@/types/chat'
import { privacyKeys } from '@/features/privacy/queries'
import { conversationKeys } from '../conversations/queries'
import {
  PAGE_SIZE,
  deleteMessage,
  editMessage,
  fetchLinkPreview,
  fetchMessagePage,
  fetchPinnedMessages,
  fetchSavedIds,
  insertMessage,
  pinMessage,
  reactToMessage,
  searchMessages,
  setSaved,
  withMediaUrls,
  type SavedMessage,
} from './api'

type Pages = InfiniteData<CachedMessage[], string | undefined>

const messageKeys = {
  list: (conversationId: string) => ['messages', conversationId] as const,
  send: ['send-message'] as const,
  pinned: (conversationId: string) => ['pinned', conversationId] as const,
  saved: ['saved-messages'] as const,
  search: (query: string) => ['message-search', query] as const,
  linkPreview: (url: string) => ['link-preview', url] as const,
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

function patchMessage(qc: QueryClient, conversationId: string, id: string, patch: Partial<CachedMessage>) {
  qc.setQueryData<Pages>(
    messageKeys.list(conversationId),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => page.map((m) => (m.id === id ? { ...m, ...patch } : m))),
      },
  )
}

function removeMessage(qc: QueryClient, conversationId: string, id: string) {
  qc.setQueryData<Pages>(
    messageKeys.list(conversationId),
    (data) => data && { ...data, pages: data.pages.map((page) => page.filter((m) => m.id !== id)) },
  )
}

/** Adds the message to the newest page, or updates it in place if it's already there (a retry or an echo). */
export function upsertMessage(qc: QueryClient, conversationId: string, message: CachedMessage) {
  qc.setQueryData<Pages>(messageKeys.list(conversationId), (data) => {
    if (!data) return data
    const exists = data.pages.some((page) => page.some((m) => m.id === message.id))
    if (exists) {
      // Merge, so a Realtime echo of your own message keeps its local image preview.
      return {
        ...data,
        pages: data.pages.map((page) => page.map((m) => (m.id === message.id ? { ...m, ...message } : m))),
      }
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

/**
 * A message was edited, deleted or pinned (by you or live from someone else): update it
 * in the thread, in the chat list's preview, and in the pinned bar.
 */
export function applyMessageUpdate(qc: QueryClient, message: Message) {
  const changes: Partial<CachedMessage> = {
    content: message.content,
    kind: message.kind,
    attachment: message.attachment,
    imagePath: message.imagePath,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    pinnedAt: message.pinnedAt,
    ...(message.deletedAt ? { reactions: [], imageUrl: undefined, fileUrl: undefined, mentions: [] } : {}),
  }
  patchMessage(qc, message.conversationId, message.id, changes)
  qc.setQueryData<Conversation[]>(conversationKeys.all, (list) =>
    list?.map((c) => (c.lastMessage?.id === message.id ? { ...c, lastMessage: { ...c.lastMessage, ...changes } } : c)),
  )
  qc.invalidateQueries({ queryKey: messageKeys.pinned(message.conversationId) })
}

/** Someone reacted (or took their reaction back): one reaction per person. */
export function applyReaction(
  qc: QueryClient,
  conversationId: string,
  messageId: string,
  userId: string,
  emoji: string | null,
) {
  qc.setQueryData<Pages>(
    messageKeys.list(conversationId),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) =>
          page.map((m) => {
            if (m.id !== messageId) return m
            const others: Reaction[] = (m.reactions ?? []).filter((r) => r.userId !== userId)
            return { ...m, reactions: emoji ? [...others, { userId, emoji }] : others }
          }),
        ),
      },
  )
}

// ---------- sending, with an outbox and upload progress ----------

/** Uploads in progress, so the bubble's cancel button can stop one. */
const uploads = new Map<string, AbortController>()

export function cancelUpload(messageId: string) {
  uploads.get(messageId)?.abort()
}

/** Progress is saved to the cache at most every 5%, so a big upload doesn't re-render constantly. */
const PROGRESS_STEP = 0.05

/**
 * Sending a message, registered once on the QueryClient (not inside a component) so
 * that the outbox works: offline, TanStack Query pauses the send and resumes it when
 * you're back online, and a paused text message even survives closing Hamsa (it's
 * saved with the cache and resumed at start-up).
 */
export function registerMessageMutations(qc: QueryClient) {
  qc.setMutationDefaults(messageKeys.send, {
    mutationFn: async (message: CachedMessage) => {
      const controller = new AbortController()
      uploads.set(message.id, controller)
      let shown = 0
      try {
        return await insertMessage(
          {
            id: message.id,
            conversationId: message.conversationId,
            kind: message.kind,
            content: message.content,
            file: message.file,
            attachment: message.attachment,
            replyToId: message.replyToId,
          },
          {
            signal: controller.signal,
            onProgress: (fraction) => {
              if (fraction - shown < PROGRESS_STEP && fraction < 1) return
              shown = fraction
              patchMessage(qc, message.conversationId, message.id, { progress: fraction })
            },
          },
        )
      } finally {
        uploads.delete(message.id)
      }
    },

    // Runs before the request: the message shows up instantly as "sending".
    onMutate: async (message: CachedMessage) => {
      await qc.cancelQueries({ queryKey: messageKeys.list(message.conversationId) })
      const optimistic = { ...message, pending: 'sending' as const, progress: message.file ? 0 : undefined }
      upsertMessage(qc, message.conversationId, optimistic)
      bumpConversation(qc, optimistic)
    },

    onSuccess: async (saved: SavedMessage, message: CachedMessage) => {
      const { conversationId } = message
      patchMessage(qc, conversationId, message.id, { pending: undefined, file: undefined, progress: undefined })
      if (!message.file) return
      // Swap the local preview for the uploaded file, then free the preview's memory.
      const [uploaded] = await withMediaUrls([{ ...message, ...saved, imageUrl: undefined, fileUrl: undefined }]).catch(
        () => [undefined],
      )
      if (!uploaded) return
      patchMessage(qc, conversationId, message.id, {
        imagePath: uploaded.imagePath,
        attachment: uploaded.attachment,
        imageUrl: uploaded.imageUrl,
        fileUrl: uploaded.fileUrl,
      })
      for (const url of [message.imageUrl, message.fileUrl]) if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    },

    // Cancelled: the message goes away. Failed: it stays, marked failed, with a retry button.
    // The other person may have just blocked you: check, so the chat can say so.
    onError: (error: Error, message: CachedMessage) => {
      if (error.name === 'AbortError') {
        removeMessage(qc, message.conversationId, message.id)
        for (const url of [message.imageUrl, message.fileUrl]) if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
        return
      }
      patchMessage(qc, message.conversationId, message.id, { pending: 'failed', progress: undefined })
      qc.invalidateQueries({ queryKey: privacyKeys.blockedConversations })
    },

    onSettled: () => qc.invalidateQueries({ queryKey: conversationKeys.all }),
  })
}

export function useSendMessage() {
  return useMutation<SavedMessage, Error, CachedMessage>({ mutationKey: messageKeys.send })
}

// ---------- what you can do with a message ----------

/** Edit, delete for everyone, react, pin and save: each shown right away, then confirmed. */
export function useMessageActions(conversationId: string, currentUserId: string) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: messageKeys.list(conversationId) })

  const edit = useMutation({
    mutationFn: ({ message, content }: { message: Message; content: string }) => editMessage(message.id, content),
    onMutate: ({ message, content }) =>
      applyMessageUpdate(qc, { ...message, content, editedAt: new Date().toISOString() }),
    onError: refresh,
  })

  const remove = useMutation({
    mutationFn: (message: Message) => deleteMessage(message.id),
    onMutate: (message) =>
      applyMessageUpdate(qc, {
        ...message,
        kind: 'text',
        content: undefined,
        attachment: undefined,
        imagePath: undefined,
        pinnedAt: undefined,
        deletedAt: new Date().toISOString(),
      }),
    onError: refresh,
    onSettled: () => qc.invalidateQueries({ queryKey: conversationKeys.all }),
  })

  const react = useMutation({
    mutationFn: ({ message, emoji }: { message: Message; emoji: string | null }) => reactToMessage(message.id, emoji),
    onMutate: ({ message, emoji }) => applyReaction(qc, conversationId, message.id, currentUserId, emoji),
    onError: refresh,
  })

  const pin = useMutation({
    mutationFn: ({ message, pinned }: { message: Message; pinned: boolean }) => pinMessage(message.id, pinned),
    onSettled: () => {
      refresh()
      qc.invalidateQueries({ queryKey: messageKeys.pinned(conversationId) })
    },
  })

  const save = useMutation({
    mutationFn: ({ message, saved }: { message: Message; saved: boolean }) => setSaved(message.id, saved),
    onMutate: ({ message, saved }) =>
      qc.setQueryData<string[]>(messageKeys.saved, (ids = []) =>
        saved ? [...ids, message.id] : ids.filter((id) => id !== message.id),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: messageKeys.saved }),
  })

  return { edit, remove, react, pin, save }
}

export function usePinnedMessages(conversationId: string) {
  return useQuery({ queryKey: messageKeys.pinned(conversationId), queryFn: () => fetchPinnedMessages(conversationId) })
}

/** Ids of the messages you saved, in every chat. */
export function useSavedIds() {
  return useQuery({ queryKey: messageKeys.saved, queryFn: fetchSavedIds, select: (ids) => new Set(ids) })
}

export function useMessageSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: messageKeys.search(q),
    queryFn: () => searchMessages(q),
    enabled: q.length >= 2,
    staleTime: 30_000,
  })
}

export function useLinkPreview(url: string | undefined) {
  return useQuery({
    queryKey: messageKeys.linkPreview(url ?? ''),
    queryFn: () => fetchLinkPreview(url!),
    enabled: Boolean(url),
    staleTime: Infinity,
    retry: false,
  })
}
