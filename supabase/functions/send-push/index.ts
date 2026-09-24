// Supabase Edge Function: sends a Web Push notification for every new message.
// Called by a Database Webhook on INSERT into public.messages (see README → Push notifications).
//
// Secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

interface MessageRecord {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  kind: string
  attachment: { name?: string } | null
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

  // Everyone in the conversation except the sender, minus people who muted it.
  const { data: participants, error } = await supabase
    .from('conversation_participants')
    .select('user_id, muted')
    .eq('conversation_id', m.conversation_id)
    .neq('user_id', m.sender_id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const recipients = (participants ?? []).filter((p) => !p.muted).map((p) => p.user_id)
  if (recipients.length === 0) return Response.json({ sent: 0 })

  const [{ data: sender }, { data: conversation }, { data: subscriptions }] = await Promise.all([
    supabase.from('profiles').select('full_name, avatar_url').eq('id', m.sender_id).single(),
    supabase.from('conversations').select('is_group, name, avatar_url').eq('id', m.conversation_id).single(),
    supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', recipients),
  ])
  if (!subscriptions?.length) return Response.json({ sent: 0 })

  const title = conversation?.is_group ? `${sender?.full_name} · ${conversation.name}` : (sender?.full_name ?? 'Hamsa')
  const body = JSON.stringify({
    title,
    body: preview(m),
    icon: (conversation?.is_group ? conversation.avatar_url : sender?.avatar_url) ?? '/icons/icon-192.png',
    conversationId: m.conversation_id,
    // One notification per chat: a newer message replaces the older one.
    tag: m.conversation_id,
  })

  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60 * 24 }),
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
