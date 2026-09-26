import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { queryClient } from '@/lib/queryClient'
import { clearDrafts } from '@/features/messages/drafts'
import { claimPersistedCache, clearPersistedCache } from '@/lib/queryPersistence'
import { supabase } from '@/lib/supabase'

/** The current session, kept in sync with sign-in, sign-out and token refresh. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Never show one person's cached chats to the next person on this browser,
    // even if the first one never signed out.
    const adopt = (next: Session | null) => {
      if (next && claimPersistedCache(next.user.id)) {
        queryClient.clear()
        clearDrafts()
      }
      setSession(next)
    }

    supabase.auth.getSession().then(({ data }) => {
      adopt(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
      adopt(newSession)
      if (event === 'SIGNED_OUT') {
        queryClient.clear()
        clearPersistedCache()
        clearDrafts()
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return { session, loading }
}
