import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const HEARTBEAT_MS = 60_000

/**
 * Who is online right now (Realtime Presence), plus when people went offline
 * during this session. Also keeps your own "last seen" fresh in the database.
 */
export function usePresence(userId: string) {
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set())
  const [wentOfflineAt, setWentOfflineAt] = useState<Record<string, string>>({})

  useEffect(() => {
    // Private channel: the realtime.messages policies only let signed-in users join.
    const channel = supabase.channel('online-users', {
      config: { private: true, presence: { key: userId } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const now = new Set(Object.keys(channel.presenceState()))
        setOnline((before) => {
          const left = [...before].filter((id) => !now.has(id))
          if (left.length > 0) {
            const at = new Date().toISOString()
            setWentOfflineAt((map) => ({ ...map, ...Object.fromEntries(left.map((id) => [id, at])) }))
          }
          return now
        })
      })

    let cancelled = false
    supabase.realtime.setAuth().then(() => {
      if (cancelled) return
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ online_at: new Date().toISOString() })
      })
    })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId])

  // "Last seen": touch it every minute while the tab is visible, and when you leave.
  useEffect(() => {
    const touch = () => {
      supabase.rpc('touch_last_seen').then(() => undefined)
    }
    touch()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') touch()
    }, HEARTBEAT_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') touch()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', touch)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', touch)
    }
  }, [])

  return { online, wentOfflineAt }
}
