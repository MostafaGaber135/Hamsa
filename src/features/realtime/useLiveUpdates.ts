import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toMessage, type MessageRowLike } from '@/features/conversations/api'
import { conversationKeys } from '@/features/conversations/queries'
import { friendKeys } from '@/features/friends/queries'
import { withMediaUrls } from '@/features/messages/api'
import { applyMessageUpdate, applyReaction, bumpConversation, upsertMessage } from '@/features/messages/queries'
import { supabase } from '@/lib/supabase'
import type { Conversation } from '@/types/chat'

export type Connection = 'connecting' | 'live' | 'lost'

interface ReadEvent {
  conversation_id: string
  user_id: string
  last_read_at: string
}

interface ReactionEvent {
  message_id: string
  conversation_id: string
  user_id: string
  emoji: string | null
}

interface Options {
  userId: string
  /** The conversation you're looking at right now, if any. */
  openConversationId: string | null
  /** A message arrived in the open conversation while the tab is visible. */
  onReadWhileOpen: (conversationId: string) => void
}

/**
 * Keeps the cache in sync with the database through your own private channel
 * ("user:<id>"). Database triggers send only what concerns you (Broadcast from
 * Database): new messages, edits and deletions, reactions, read receipts, "your chat
 * list changed", "your friends changed". Events patch the cache directly instead of refetching.
 */
export function useLiveUpdates({ userId, openConversationId, onReadWhileOpen }: Options) {
  const qc = useQueryClient()
  const [connection, setConnection] = useState<Connection>('connecting')

  // The handlers below are set up once; these refs let them see the latest values.
  const openRef = useRef(openConversationId)
  const onReadRef = useRef(onReadWhileOpen)
  useEffect(() => {
    openRef.current = openConversationId
    onReadRef.current = onReadWhileOpen
  })

  useEffect(() => {
    let wasLost = false
    // Removing the channel reports CLOSED; ignore anything after cleanup.
    let disposed = false

    async function onMessage(row: MessageRowLike) {
      const [message] = await withMediaUrls([toMessage(row)]).catch(() => [toMessage(row)])
      const conversationId = message.conversationId
      const list = qc.getQueryData<Conversation[]>(conversationKeys.all)

      // A conversation we don't have yet (someone just started it, or a deleted chat came back).
      if (!list?.some((c) => c.id === conversationId)) {
        qc.invalidateQueries({ queryKey: conversationKeys.all })
      }

      // Your own message may already be there (optimistic): this confirms it.
      upsertMessage(qc, conversationId, { ...message, pending: undefined, file: undefined })
      bumpConversation(qc, message)

      if (message.senderId === userId) return
      const readingIt = openRef.current === conversationId && document.visibilityState === 'visible'
      if (readingIt) {
        onReadRef.current(conversationId)
      } else {
        qc.setQueryData<Conversation[]>(conversationKeys.all, (cs) =>
          cs?.map((c) => (c.id === conversationId ? { ...c, unreadCount: c.unreadCount + 1 } : c)),
        )
      }
    }

    // Someone read the conversation: move their read marker so your ticks turn to "read".
    function onRead(event: ReadEvent) {
      qc.setQueryData<Conversation[]>(conversationKeys.all, (cs) =>
        cs?.map((c) =>
          c.id === event.conversation_id
            ? {
                ...c,
                members: c.members.map((m) => (m.id === event.user_id ? { ...m, lastReadAt: event.last_read_at } : m)),
              }
            : c,
        ),
      )
    }

    const channel = supabase
      .channel(`user:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'message' }, ({ payload }) => onMessage(payload as MessageRowLike))
      .on('broadcast', { event: 'read' }, ({ payload }) => onRead(payload as ReadEvent))
      // Edited, deleted for everyone, pinned or unpinned.
      .on('broadcast', { event: 'message_updated' }, ({ payload }) => applyMessageUpdate(qc, toMessage(payload as MessageRowLike)))
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        const r = payload as ReactionEvent
        if (r.user_id !== userId) applyReaction(qc, r.conversation_id, r.message_id, r.user_id, r.emoji)
      })
      // Added to or removed from a chat, a new chat, a group renamed or given a new photo, roles.
      .on('broadcast', { event: 'conversations' }, () => qc.invalidateQueries({ queryKey: conversationKeys.all }))
      .on('broadcast', { event: 'friends' }, () => qc.invalidateQueries({ queryKey: friendKeys.all }))

    // Private channel: Realtime needs the signed-in user's token before joining.
    supabase.realtime.setAuth().then(() => {
      if (disposed) return
      channel.subscribe((status) => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          setConnection('live')
          // Back after a drop: fetch what we missed while disconnected.
          if (wasLost) qc.invalidateQueries()
          wasLost = false
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wasLost = true
          setConnection('lost')
        }
      })
    })

    return () => {
      disposed = true
      supabase.removeChannel(channel)
    }
  }, [qc, userId])

  // The browser knows about lost Wi-Fi before the socket does.
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setBrowserOnline(true)
    const off = () => setBrowserOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return browserOnline ? connection : 'lost'
}
