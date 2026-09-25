// Supabase Edge Function: "Mark as read" from a push notification, without opening Hamsa.
// The service worker sends the token that send-push put in the notification; it allows
// only marking that one chat read for that one person, and expires after a week.
//
// Secret (Edge Functions → Secrets): ACTION_SECRET, the same value send-push uses.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const ACTION_SECRET = Deno.env.get('ACTION_SECRET')

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

/** The token's claims if its signature is right and it hasn't expired (same format as send-push). */
async function verify(token: unknown): Promise<{ c: string; u: string } | null> {
  if (!ACTION_SECRET || typeof token !== 'string') return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(ACTION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signature), new TextEncoder().encode(body))
    if (!valid) return null
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(body)))
    if (typeof claims?.c !== 'string' || typeof claims?.u !== 'string' || !(claims.e > Date.now())) return null
    return { c: claims.c, u: claims.u }
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  const { token } = await req.json().catch(() => ({ token: null }))
  const claims = await verify(token)
  if (!claims) return new Response('Forbidden', { status: 403, headers: cors })

  // The same as opening the chat: read up to now, and no longer "marked unread".
  const { error } = await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString(), marked_unread: false })
    .eq('conversation_id', claims.c)
    .eq('user_id', claims.u)
  if (error) return new Response('Could not update', { status: 500, headers: cors })

  return new Response(null, { status: 204, headers: cors })
})
