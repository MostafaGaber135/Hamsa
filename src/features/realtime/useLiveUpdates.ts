import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toMessage } from '@/features/conversations/api'
import { conversationKeys } from '@/features/conversations/queries'
import { friendKeys } from '@/features/friends/queries'
import { withImageUrls } from '@/features/messages/api'
import { bumpConversation, upsertMessage } from '@/features/messages/queries'
import { supabase } from '@/lib/supabase'
import type { Conversation } from '@/types/chat'

export type Connection = 'connecting' | 'live' | 'lost'

interface MessageRow {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  image_path: string | null
  created_at: string
}

interface ParticipantRow {
  conversation_id: string
  user_id: string
  last_read_at: string
}

interface Options {
  userId: string
  /** The conversation you're looking at right now, if any. */
  openConversationId: string | null
  /** A message arrived in the open conversation while the tab is visible. */
  onReadWhileOpen: (conversationId: string) => void
}

/**
 * Keeps the cache in sync with the database through Realtime Postgres Changes:
 * new messages, read receipts, conversations you were added to, and friend requests.
 * Realtime applies the tables' RLS policies, so you only receive rows you're allowed to see.
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

    async function onMessage(row: MessageRow) {
      const [message] = await withImageUrls([toMessage(row)]).catch(() => [toMessage(row)])
      const conversationId = message.conversationId
      const list = qc.getQueryData<Conversation[]>(conversationKeys.all)

      // A conversation we don't have yet (someone just started it, or a deleted chat came back).
      if (!list?.some((c) => c.id === conversationId)) {
        qc.invalidateQueries({ queryKey: conversationKeys.all })
      }

      // Your own message may already be there (optimistic): this confirms it.
      upsertMessage(qc, conversationId, { ...message, pending: undefined, imageFile: undefined })
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
    function onParticipantUpdate(row: ParticipantRow) {
      if (row.user_id === userId) return
      qc.setQueryData<Conversation[]>(conversationKeys.all, (cs) =>
        cs?.map((c) =>
          c.id === row.conversation_id
            ? { ...c, members: c.members.map((m) => (m.id === row.user_id ? { ...m, lastReadAt: row.last_read_at } : m)) }
            : c,
        ),
      )
    }

    const refreshConversations = () => qc.invalidateQueries({ queryKey: conversationKeys.all })

    const channel = supabase
      .channel(`db:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) =>
        onMessage(row as MessageRow),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants' }, ({ new: row }) =>
        onParticipantUpdate(row as ParticipantRow),
      )
      // Added to a group, someone left, a new 1:1 conversation with you.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_participants' }, refreshConversations)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversation_participants' }, refreshConversations)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () =>
        qc.invalidateQueries({ queryKey: friendKeys.all }),
      )
      .subscribe((status) => {
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
