// Supabase Edge Function: sends a Web Push notification for every new message.
// Called by a Database Webhook on INSERT into public.messages (see README → Push notifications).
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET, and optionally
// ACTION_SECRET (the "Mark as read" button; see notification-action).

import webpush from 'npm:web-push@3.6.7'
import { signActionToken } from '../_shared/actionToken.ts'
import { admin } from '../_shared/admin.ts'
import { requireEnv } from '../_shared/env.ts'

webpush.setVapidDetails(requireEnv('VAPID_SUBJECT'), requireEnv('VAPID_PUBLIC_KEY'), requireEnv('VAPID_PRIVATE_KEY'))

const WEBHOOK_SECRET = requireEnv('WEBHOOK_SECRET')
const ACTION_SECRET = Deno.env.get('ACTION_SECRET')
const ACTION_URL = `${requireEnv('SUPABASE_URL')}/functions/v1/notification-action`

/** Shown when a chat has no photo, and as the title when the sender has no name. */
const APP_NAME = 'Hamsa'
const APP_ICON = '/icons/icon-192.png'
/** A notification that can't be delivered within a day is dropped. */
const TTL_SECONDS = 24 * 60 * 60
/** Longest message text shown in a notification. */
const PREVIEW_CHARS = 180
/** The push service says this browser unsubscribed or uninstalled. */
const GONE_STATUSES = [404, 410]

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
    case 'image':
      return m.content ? `📷 ${m.content}` : '📷 Photo'
    case 'video':
      return m.content ? `🎬 ${m.content}` : '🎬 Video'
    case 'voice':
      return '🎤 Voice message'
    case 'file':
      return `📄 ${m.attachment?.name ?? 'Document'}`
    case 'location':
      return '📍 Location'
    case 'sticker':
      return '🙂 Sticker'
    default:
      return (m.content ?? '').slice(0, PREVIEW_CHARS)
  }
}

Deno.serve(async (req) => {
  // Only the database webhook knows this secret.
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 })

  const payload = await req.json()
  const m = payload?.record as MessageRecord | undefined
  if (payload?.type !== 'INSERT' || payload?.table !== 'messages' || !m) return Response.json({ skipped: true })

  // Everyone in the conversation except the sender, minus people who muted it (unless
  // they're @mentioned) or haven't accepted it yet (a message request from a stranger).
  const { data: recipients, error } = await admin.rpc('push_recipients', {
    conv_id: m.conversation_id,
    sender: m.sender_id,
    mentioned: m.mentions ?? [],
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!recipients?.length) return Response.json({ sent: 0 })

  const [{ data: sender }, { data: conversation }, { data: subscriptions }] = await Promise.all([
    admin.from('profiles').select('full_name, avatar_url').eq('id', m.sender_id).single(),
    admin.from('conversations').select('is_group, name, avatar_url').eq('id', m.conversation_id).single(),
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', recipients),
  ])
  if (!subscriptions?.length) return Response.json({ sent: 0 })

  const notification = {
    title: conversation?.is_group ? `${sender?.full_name} · ${conversation.name}` : (sender?.full_name ?? APP_NAME),
    body: preview(m),
    icon: (conversation?.is_group ? conversation.avatar_url : sender?.avatar_url) ?? APP_ICON,
    conversationId: m.conversation_id,
    // One notification per chat: a newer message replaces the older one.
    tag: m.conversation_id,
  }

  // The same notification for everyone, except each person's own "Mark as read" token.
  const bodies = new Map<string, string>()
  for (const userId of new Set(subscriptions.map((s) => s.user_id))) {
    const action = ACTION_SECRET
      ? { url: ACTION_URL, token: await signActionToken(ACTION_SECRET, { c: m.conversation_id, u: userId }) }
      : undefined
    bodies.set(userId, JSON.stringify({ ...notification, action }))
  }

  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        bodies.get(s.user_id)!,
        {
          TTL: TTL_SECONDS,
        },
      ),
    ),
  )

  // A browser that uninstalled or revoked permission: forget it.
  const gone = subscriptions.filter((_, i) => {
    const r = results[i]
    return r.status === 'rejected' && GONE_STATUSES.includes((r.reason as { statusCode?: number })?.statusCode ?? 0)
  })
  if (gone.length)
    await admin
      .from('push_subscriptions')
      .delete()
      .in(
        'id',
        gone.map((g) => g.id),
      )

  return Response.json({ sent: results.filter((r) => r.status === 'fulfilled').length, removed: gone.length })
})
