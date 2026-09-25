import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const SEND_EVERY_MS = 2_000
const HIDE_AFTER_MS = 5_000

type TypingMap = Record<string, string[]>

/**
 * One private Realtime channel per conversation ("typing:<id>"), carrying:
 * - "Sara is typing…" through Broadcast (nothing is stored in the database)
 * - who is online through Presence
 * - call signalling (offers, answers, network candidates) through Broadcast
 * The realtime.messages policies only let members in (and not a one-to-one chat
 * where either person blocked the other), so your online status only ever
 * reaches people you chat with. `shareOnline` false: you watch, but never appear.
 * `quietIds`: conversations where you never appear either — message requests you
 * haven't accepted, so a stranger can't message you just to see when you're online.
 */
export function useConversationChannels(
  conversationIds: string[],
  userId: string,
  shareOnline: boolean,
  quietIds: string[],
  /** A call signal arrived in a conversation (see features/calls). */
  onCallSignal?: (conversationId: string, signal: unknown) => void,
) {
  const [typing, setTyping] = useState<TypingMap>({})
  const [onlineIn, setOnlineIn] = useState<Record<string, string[]>>({})
  const [wentOfflineAt, setWentOfflineAt] = useState<Record<string, string>>({})
  const channels = useRef(new Map<string, RealtimeChannel>())
  const lastSent = useRef(new Map<string, number>())
  const hideTimers = useRef(new Map<string, number>())
  const shareRef = useRef(shareOnline)
  const onCallSignalRef = useRef(onCallSignal)
  useEffect(() => {
    onCallSignalRef.current = onCallSignal
  })
  const quietKey = [...quietIds].sort().join(',')
  const quietRef = useRef(new Set(quietIds))
  const idsKey = [...conversationIds].sort().join(',')
  const appearsIn = useCallback((id: string) => shareRef.current && !quietRef.current.has(id), [])

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
        setOnlineIn(({ [id]: _gone, ...rest }) => rest)
      }
    }

    // Join the new ones.
    supabase.realtime.setAuth().then(() => {
      if (cancelled) return
      for (const id of wanted) {
        if (open.has(id)) continue
        const channel = supabase.channel(`typing:${id}`, { config: { private: true, presence: { key: userId } } })
        channel
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            if (payload?.userId && payload.userId !== userId) setUserTyping(id, payload.userId, Boolean(payload.typing))
          })
          .on('broadcast', { event: 'call' }, ({ payload }) => onCallSignalRef.current?.(id, payload))
          .on('presence', { event: 'sync' }, () => {
            const here = Object.keys(channel.presenceState()).filter((key) => key !== userId)
            setOnlineIn((map) => ({ ...map, [id]: here }))
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED' && appearsIn(id)) channel.track({})
          })
        open.set(id, channel)
      }
    })

    return () => {
      cancelled = true
    }
  }, [idsKey, userId, setUserTyping, appearsIn])

  // Turning "show when I'm online" on or off, or accepting a request, applies at once.
  useEffect(() => {
    shareRef.current = shareOnline
    quietRef.current = new Set(quietKey ? quietKey.split(',') : [])
    for (const [id, channel] of channels.current) {
      if (channel.state !== 'joined') continue
      if (appearsIn(id)) channel.track({})
      else channel.untrack()
    }
  }, [shareOnline, quietKey, appearsIn])

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

  // Online anywhere = online. Someone you share several chats with is in several channels.
  const online = useMemo<ReadonlySet<string>>(() => new Set(Object.values(onlineIn).flat()), [onlineIn])

  // Remember when people went offline during this session, for "last seen just now".
  const previousOnline = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const left = [...previousOnline.current].filter((id) => !online.has(id))
    previousOnline.current = online
    if (left.length === 0) return
    const at = new Date().toISOString()
    setWentOfflineAt((map) => ({ ...map, ...Object.fromEntries(left.map((id) => [id, at])) }))
  }, [online])

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

  /** Sends a call signal to the other people in a conversation. */
  const sendCallSignal = useCallback((conversationId: string, signal: object) => {
    channels.current.get(conversationId)?.send({ type: 'broadcast', event: 'call', payload: signal })
  }, [])

  return { typing, sendTyping, stopTyping, online, wentOfflineAt, sendCallSignal }
}
