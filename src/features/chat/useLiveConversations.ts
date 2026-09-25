import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useCall } from '@/features/calls/useCall'
import { usePrivacySettings } from '@/features/privacy/queries'
import { useConversationChannels } from '@/features/realtime/useConversationChannels'
import { useLastSeenHeartbeat } from '@/features/realtime/useLastSeen'
import { useLiveUpdates } from '@/features/realtime/useLiveUpdates'
import type { Conversation, User } from '@/types/chat'

/** How many chats get live typing and online status (plus the open one). */
const MAX_LIVE_CONVERSATIONS = 50

/** Used while a message request is open: reading it doesn't mark it read. */
const ignoreRead = () => undefined

interface Options {
  userId: string
  me: User
  /** The chat list as the server sent it. */
  serverConversations: Conversation[] | undefined
  /** The chat on screen, if any (null on the friends or profile page). */
  openConversationId: string | null
  markRead: (conversationId: string) => void
}

/**
 * Everything live about your chats: new messages and changes (your own channel),
 * typing and online status (each chat's channel), "last seen", and calls. Returns the
 * chat list with online dots, "last seen" and who's typing filled in.
 */
export function useLiveConversations({ userId, me, serverConversations, openConversationId, markRead }: Options) {
  useLastSeenHeartbeat()

  // Reading a message request doesn't tell the sender: no read receipt until you accept.
  const openIsRequest = Boolean(serverConversations?.find((c) => c.id === openConversationId)?.isRequest)
  const connection = useLiveUpdates({
    userId,
    openConversationId,
    onReadWhileOpen: openIsRequest ? ignoreRead : markRead,
  })

  // Typing and online status for your most recent chats (and the open one): one
  // Realtime channel each, so a long chat list can't exhaust the connection's channels.
  const conversationIds = useMemo(() => {
    const recent = (serverConversations ?? []).slice(0, MAX_LIVE_CONVERSATIONS).map((c) => c.id)
    return openConversationId && !recent.includes(openConversationId) ? [...recent, openConversationId] : recent
  }, [serverConversations, openConversationId])
  const requestIds = useMemo(
    () => (serverConversations ?? []).filter((c) => c.isRequest).map((c) => c.id),
    [serverConversations],
  )
  // You appear online only once your setting is known, only if it allows it,
  // and never in a message request you haven't accepted.
  const privacy = usePrivacySettings(userId)
  // Call signals arrive on the same channels; the call hook is created just below.
  const callSignal = useRef<(conversationId: string, signal: unknown) => void>(undefined)
  const channels = useConversationChannels(
    conversationIds, userId, privacy.data?.presence === 'contacts', requestIds,
    (conversationId, signal) => callSignal.current?.(conversationId, signal),
  )
  const { online, wentOfflineAt, typing, sendTyping, stopTyping } = channels

  // ---- Calls (one-to-one) ----
  const peerOf = useCallback(
    (conversationId: string) => {
      const conversation = serverConversations?.find((c) => c.id === conversationId)
      return conversation && !conversation.isGroup ? conversation.members.find((m) => m.id !== userId) : undefined
    },
    [serverConversations, userId],
  )
  const call = useCall({ userId, peerOf, send: channels.sendCallSignal })
  useEffect(() => {
    callSignal.current = call.handleSignal
  })

  // Server data + live data: online dots, "last seen", and who's typing.
  const conversations = useMemo<Conversation[]>(() => {
    const live = <T extends User>(u: T): T => {
      const leftAt = wentOfflineAt[u.id]
      const lastSeenAt = leftAt && (!u.lastSeenAt || leftAt > u.lastSeenAt) ? leftAt : u.lastSeenAt
      return { ...u, online: online.has(u.id), lastSeenAt }
    }
    return (serverConversations ?? []).map((c) => ({
      ...c,
      members: c.members.map(live),
      typingUserIds: typing[c.id] ?? [],
    }))
  }, [serverConversations, online, wentOfflineAt, typing])

  // Everyone you share a conversation with, by id.
  const users = useMemo(() => {
    const map: Record<string, User> = { [me.id]: me }
    for (const c of conversations) for (const m of c.members) map[m.id] ??= m
    return map
  }, [conversations, me])

  return { connection, conversations, users, call, sendTyping, stopTyping, openIsRequest }
}
