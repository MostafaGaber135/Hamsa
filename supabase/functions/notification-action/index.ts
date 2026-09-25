// Supabase Edge Function: "Mark as read" from a push notification, without opening Hamsa.
// The service worker sends the token that send-push put in the notification; it allows
// only marking that one chat read for that one person, and expires after a week.
//
// Secret: ACTION_SECRET, the same value send-push uses.

import { verifyActionToken } from '../_shared/actionToken.ts'
import { admin } from '../_shared/admin.ts'
import { cors, preflight } from '../_shared/cors.ts'
import { requireEnv } from '../_shared/env.ts'

const ACTION_SECRET = requireEnv('ACTION_SECRET')

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  const { token } = await req.json().catch(() => ({ token: null }))
  const claims = await verifyActionToken(ACTION_SECRET, token)
  if (!claims) return new Response('Forbidden', { status: 403, headers: cors })

  // The same as opening the chat: read up to now, and no longer "marked unread".
  const { error } = await admin
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString(), marked_unread: false })
    .eq('conversation_id', claims.c)
    .eq('user_id', claims.u)
  if (error) return new Response('Could not update', { status: 500, headers: cors })

  return new Response(null, { status: 204, headers: cors })
})
