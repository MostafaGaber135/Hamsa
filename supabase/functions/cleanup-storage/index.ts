// Supabase Edge Function: deletes files nobody uses any more — chat files whose
// message was never saved or whose conversation is gone, and replaced profile or
// group photos. Run it on a schedule (see README → Storage clean-up).
//
// Secret: CRON_SECRET.

import { admin } from '../_shared/admin.ts'
import { requireEnv } from '../_shared/env.ts'

const CRON_SECRET = requireEnv('CRON_SECRET')
/** Files removed per run; a full batch means the next run continues. */
const BATCH = 500

Deno.serve(async (req) => {
  // Only the scheduled job knows this secret.
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('Forbidden', { status: 403 })

  // The database decides what's unused; files have to be removed through the Storage API.
  const { data, error } = await admin.rpc('orphaned_files', { max_rows: BATCH })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const byBucket = new Map<string, string[]>()
  for (const file of data ?? []) byBucket.set(file.bucket_id, [...(byBucket.get(file.bucket_id) ?? []), file.name])

  const removed: Record<string, number> = {}
  for (const [bucket, names] of byBucket) {
    const { data: gone, error: removeError } = await admin.storage.from(bucket).remove(names)
    if (removeError) return Response.json({ error: removeError.message, removed }, { status: 500 })
    removed[bucket] = gone?.length ?? 0
  }

  return Response.json({ removed, more: (data?.length ?? 0) === BATCH })
})
