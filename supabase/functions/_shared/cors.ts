/**
 * For functions the browser calls. Any origin may ask: what authorises a request is
 * the caller's own token (or a signed action token), not where it comes from.
 */
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** The preflight answer, or a 405 for anything but POST; null means carry on. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })
  return null
}
