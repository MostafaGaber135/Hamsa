// Supabase Edge Function: permanently deletes the signed-in user's account.
// Called from My profile → Delete account (see README → Account deletion).
//
// Deleting the auth user deletes the profile, which takes messages, friendships,
// blocks and devices with it; a database trigger tidies conversations first.

import { admin } from '../_shared/admin.ts'
import { cors, preflight } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  // Only ever the account whose token this is.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ error: 'Not signed in' }, { status: 401, headers: cors })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return Response.json({ error: 'Not signed in' }, { status: 401, headers: cors })

  const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id)
  if (deleteError) return Response.json({ error: 'Could not delete the account' }, { status: 500, headers: cors })

  return Response.json({ deleted: true }, { headers: cors })
})
