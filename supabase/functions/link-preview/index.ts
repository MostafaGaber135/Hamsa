// Supabase Edge Function: the title and description of a link in a message.
// The server fetches the page, so the linked site never sees the reader's IP address,
// and the result is cached for a week in public.link_previews. Text only: no images.
//
// Called by signed-in users only (it checks their token).

import { admin } from '../_shared/admin.ts'
import { cors, preflight } from '../_shared/cors.ts'

const CACHE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
/** Enough of the page for its <head>. */
const MAX_BYTES = 512 * 1024
const TIMEOUT_MS = 5000
const MAX_URL_LENGTH = 2048
const MAX_TITLE = 200
const MAX_DESCRIPTION = 300
const MAX_SITE_NAME = 100

interface Preview {
  title: string | null
  description: string | null
  siteName: string | null
}

/** Public web pages only: no IP addresses, local names or other ports. */
function isFetchable(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) return false
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.port && url.port !== '80' && url.port !== '443') return false
    if (url.username || url.password) return false
    const host = url.hostname.toLowerCase()
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost')
      return false
    // IPv4 or IPv6 literals (e.g. 169.254.169.254, [::1]).
    if (/^[\d.]+$/.test(host) || host.startsWith('[')) return false
    return true
  } catch {
    return false
  }
}

function decodeEntities(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function clean(value: string | undefined, max: number) {
  const text = value ? decodeEntities(value).replace(/\s+/g, ' ').trim() : ''
  return text ? text.slice(0, max) : null
}

function metaContent(html: string, names: string[]) {
  for (const name of names) {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i'))?.[0]
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1]
    if (content) return content
  }
  return undefined
}

/** Reads at most MAX_BYTES of the page: enough for <head>. */
async function readHead(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => undefined)
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset)
    bytes.set(part, offset)
    offset += part.length
  }
  return new TextDecoder().decode(bytes)
}

async function fetchPreview(url: string): Promise<Preview> {
  const empty = { title: null, description: null, siteName: null }
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'HamsaLinkPreview/1.0', Accept: 'text/html' },
  }).catch(() => null)
  // A redirect can't lead somewhere we wouldn't fetch directly.
  if (!response?.ok || !isFetchable(response.url) || !response.headers.get('content-type')?.includes('text/html')) {
    return empty
  }

  const html = await readHead(response)
  return {
    title: clean(
      metaContent(html, ['og:title', 'twitter:title']) ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1],
      MAX_TITLE,
    ),
    description: clean(metaContent(html, ['og:description', 'twitter:description', 'description']), MAX_DESCRIPTION),
    siteName: clean(
      metaContent(html, ['og:site_name']) ?? new URL(response.url).hostname.replace(/^www\./, ''),
      MAX_SITE_NAME,
    ),
  }
}

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  const { data } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  if (!data.user) return Response.json({ error: 'Not signed in' }, { status: 401, headers: cors })

  const { url } = await req.json().catch(() => ({ url: null }))
  if (!isFetchable(url)) return Response.json({ title: null, description: null, siteName: null }, { headers: cors })

  const since = new Date(Date.now() - CACHE_DAYS * DAY_MS).toISOString()
  const { data: cached } = await admin
    .from('link_previews')
    .select('title, description, site_name')
    .eq('url', url)
    .gt('fetched_at', since)
    .maybeSingle()
  if (cached) {
    return Response.json(
      { title: cached.title, description: cached.description, siteName: cached.site_name },
      { headers: cors },
    )
  }

  const preview = await fetchPreview(url)
  // Pages without a preview are remembered too, so they aren't fetched again for a week.
  await admin.from('link_previews').upsert({
    url,
    title: preview.title,
    description: preview.description,
    site_name: preview.siteName,
    fetched_at: new Date().toISOString(),
  })
  return Response.json(preview, { headers: cors })
})
