import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const HEARTBEAT_MS = 60_000

/**
 * Keeps your "last seen" fresh: every minute while the tab is visible, and when you
 * leave. Who may read it is decided by the database (visible_last_seen).
 */
export function useLastSeenHeartbeat() {
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
}
