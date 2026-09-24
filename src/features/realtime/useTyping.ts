import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const SEND_EVERY_MS = 2_000
const HIDE_AFTER_MS = 5_000

type TypingMap = Record<string, string[]>

/**
 * "Sara is typing…" through Realtime Broadcast: nothing is stored in the database.
 * One private channel per conversation ("typing:<id>"); the realtime.messages policies
 * only let members of that conversation join it.
 */
export function useTyping(conversationIds: string[], userId: string) {
  const [typing, setTyping] = useState<TypingMap>({})
  const channels = useRef(new Map<string, RealtimeChannel>())
  const lastSent = useRef(new Map<string, number>())
  const hideTimers = useRef(new Map<string, number>())
  const idsKey = [...conversationIds].sort().join(',')

  const setUserTyping = useCallback((conversationId: string, typerId: string, isTyping: boolean) => {
    const update = (on: boolean) =>
      setTyping((map) => {
        const current = map[conversationId] ?? []
        if (on === current.includes(typerId)) return map
        const next = on ? [...current, typerId] : current.filter((id) => id !== typerId)
        return { ...map, [conversationId]: next }
      })

    const timerKey = `${conversationId}:${typerId}`
    window.clearTimeout(hideTimers.current.get(timerKey))
    // Hide it if their next keystroke event doesn't arrive in time.
    if (isTyping) hideTimers.current.set(timerKey, window.setTimeout(() => update(false), HIDE_AFTER_MS))
    update(isTyping)
  }, [])

  useEffect(() => {
    const wanted = new Set(idsKey ? idsKey.split(',') : [])
    const open = channels.current
    let cancelled = false

    // Leave conversations that are gone from the list.
    for (const [id, channel] of open) {
      if (!wanted.has(id)) {
        supabase.removeChannel(channel)
        open.delete(id)
      }
    }

    // Join the new ones.
    supabase.realtime.setAuth().then(() => {
      if (cancelled) return
      for (const id of wanted) {
        if (open.has(id)) continue
        const channel = supabase
          .channel(`typing:${id}`, { config: { private: true } })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            if (payload?.userId && payload.userId !== userId) setUserTyping(id, payload.userId, Boolean(payload.typing))
          })
          .subscribe()
        open.set(id, channel)
      }
    })

    return () => {
      cancelled = true
    }
  }, [idsKey, userId, setUserTyping])

  // Leave every channel when signing out.
  useEffect(() => {
    const open = channels.current
    const timers = hideTimers.current
    return () => {
      for (const channel of open.values()) supabase.removeChannel(channel)
      open.clear()
      for (const timer of timers.values()) window.clearTimeout(timer)
    }
  }, [])

  /** Call on every keystroke; it sends at most one event every 2 seconds. */
  const sendTyping = useCallback(
    (conversationId: string) => {
      const now = Date.now()
      if (now - (lastSent.current.get(conversationId) ?? 0) < SEND_EVERY_MS) return
      lastSent.current.set(conversationId, now)
      channels.current.get(conversationId)?.send({ type: 'broadcast', event: 'typing', payload: { userId, typing: true } })
    },
    [userId],
  )

  /** Call when the message is sent, so the indicator disappears right away. */
  const stopTyping = useCallback(
    (conversationId: string) => {
      lastSent.current.delete(conversationId)
      channels.current.get(conversationId)?.send({ type: 'broadcast', event: 'typing', payload: { userId, typing: false } })
    },
    [userId],
  )

  return { typing, sendTyping, stopTyping }
}
