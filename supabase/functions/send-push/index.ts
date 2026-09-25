// Supabase Edge Function: sends a Web Push notification for every new message.
// Called by a Database Webhook on INSERT into public.messages (see README → Push notifications).
//
// Secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET,
// and optionally ACTION_SECRET (enables the "Mark as read" button; see notification-action).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

// ---- "Mark as read" from the notification ----
// The service worker can't act as the user (it has no session), so each notification
// carries a token that allows exactly one thing: marking this chat read for this person,
// for a week. Signed with ACTION_SECRET; checked by the notification-action function
// (which has the same few lines to verify it).
const ACTION_SECRET = Deno.env.get('ACTION_SECRET')
const ACTION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notification-action`
const ACTION_TOKEN_DAYS = 7

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function actionToken(conversationId: string, userId: string): Promise<string | undefined> {
  if (!ACTION_SECRET) return undefined
  const claims = { c: conversationId, u: userId, e: Date.now() + ACTION_TOKEN_DAYS * 24 * 60 * 60 * 1000 }
  const body = base64url(new TextEncoder().encode(JSON.stringify(claims)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(ACTION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return `${body}.${base64url(signature)}`
}

interface MessageRecord {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  kind: string
  attachment: { name?: string } | null
  /** Group members @mentioned: they're notified even if they muted the group. */
  mentions?: string[] | null
}

function preview(m: MessageRecord) {
  switch (m.kind) {
    case 'image': return m.content ? `📷 ${m.content}` : '📷 Photo'
    case 'video': return m.content ? `🎬 ${m.content}` : '🎬 Video'
    case 'voice': return '🎤 Voice message'
    case 'file': return `📄 ${m.attachment?.name ?? 'Document'}`
    case 'location': return '📍 Location'
    case 'sticker': return '🙂 Sticker'
    default: return (m.content ?? '').slice(0, 180)
  }
}

Deno.serve(async (req) => {
  // Only the database webhook knows this secret.
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('Forbidden', { status: 403 })
  }

  const payload = await req.json()
  const m = payload?.record as MessageRecord | undefined
  if (payload?.type !== 'INSERT' || payload?.table !== 'messages' || !m) {
    return Response.json({ skipped: true })
  }

  // Everyone in the conversation except the sender, minus people who muted it (unless
  // they're @mentioned) or haven't accepted it yet (a message request from a stranger).
  const { data: recipients, error } = await supabase.rpc('push_recipients', {
    conv_id: m.conversation_id,
    sender: m.sender_id,
    mentioned: m.mentions ?? [],
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!recipients?.length) return Response.json({ sent: 0 })

  const [{ data: sender }, { data: conversation }, { data: subscriptions }] = await Promise.all([
    supabase.from('profiles').select('full_name, avatar_url').eq('id', m.sender_id).single(),
    supabase.from('conversations').select('is_group, name, avatar_url').eq('id', m.conversation_id).single(),
    supabase.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', recipients),
  ])
  if (!subscriptions?.length) return Response.json({ sent: 0 })

  const title = conversation?.is_group ? `${sender?.full_name} · ${conversation.name}` : (sender?.full_name ?? 'Hamsa')
  const notification = {
    title,
    body: preview(m),
    icon: (conversation?.is_group ? conversation.avatar_url : sender?.avatar_url) ?? '/icons/icon-192.png',
    conversationId: m.conversation_id,
    // One notification per chat: a newer message replaces the older one.
    tag: m.conversation_id,
  }

  // The same notification for everyone, except each person's own "Mark as read" token.
  const bodies = new Map<string, string>()
  for (const userId of new Set(subscriptions.map((s) => s.user_id))) {
    const token = await actionToken(m.conversation_id, userId)
    bodies.set(userId, JSON.stringify(token ? { ...notification, action: { url: ACTION_URL, token } } : notification))
  }

  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, bodies.get(s.user_id)!, {
        TTL: 60 * 60 * 24,
      }),
    ),
  )

  // A browser that uninstalled or revoked permission answers 404/410: forget it.
  const gone = subscriptions.filter((_, i) => {
    const r = results[i]
    return r.status === 'rejected' && [404, 410].includes((r.reason as { statusCode?: number })?.statusCode ?? 0)
  })
  if (gone.length) await supabase.from('push_subscriptions').delete().in('id', gone.map((g) => g.id))

  return Response.json({ sent: results.filter((r) => r.status === 'fulfilled').length, removed: gone.length })
})
