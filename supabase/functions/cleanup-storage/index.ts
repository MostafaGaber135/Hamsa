// Supabase Edge Function: deletes files nobody uses any more — chat files whose
// message was never saved or whose conversation is gone, and replaced profile or
// group photos. Run it on a schedule (see README → Storage clean-up).
//
// Secret (Edge Functions → Secrets): CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const BATCH = 500

Deno.serve(async (req) => {
  // Only the scheduled job knows this secret.
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('Forbidden', { status: 403 })
  }

  // The database decides what's unused; files have to be removed through the Storage API.
  const { data, error } = await supabase.rpc('orphaned_files', { max_rows: BATCH })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const byBucket = new Map<string, string[]>()
  for (const file of data ?? []) byBucket.set(file.bucket_id, [...(byBucket.get(file.bucket_id) ?? []), file.name])

  const removed: Record<string, number> = {}
  for (const [bucket, names] of byBucket) {
    const { data: gone, error: removeError } = await supabase.storage.from(bucket).remove(names)
    if (removeError) return Response.json({ error: removeError.message, removed }, { status: 500 })
    removed[bucket] = gone?.length ?? 0
  }

  // A full batch means there may be more: the next run picks them up.
  return Response.json({ removed, more: (data?.length ?? 0) === BATCH })
})
