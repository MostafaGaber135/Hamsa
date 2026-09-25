// Supabase Edge Function: permanently deletes the signed-in user's account.
// Called from My profile → Delete account (see README → Account deletion).
//
// Deleting the auth user deletes the profile, which takes messages, friendships,
// blocks and devices with it; a database trigger tidies conversations first.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// The app calls this from the browser. The caller's own token is what authorises
// the deletion, so any origin may ask.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  // Only ever the account whose token this is.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  const { data, error } = token ? await admin.auth.getUser(token) : { data: { user: null }, error: null }
  if (error || !data.user) return Response.json({ error: 'Not signed in' }, { status: 401, headers: cors })

  const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id)
  if (deleteError) return Response.json({ error: 'Could not delete the account' }, { status: 500, headers: cors })

  return Response.json({ deleted: true }, { headers: cors })
})
