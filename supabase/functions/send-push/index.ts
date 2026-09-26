// Supabase Edge Function: sends a Web Push notification for every new message, and for
// friend requests, groups and reactions (the bell's notifications).
// Called by two Database Webhooks, on INSERT into public.messages and into
// public.notifications (see README → Push notifications).
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
/** Mentions and replies arrive as messages already; these are the bell's other events. */
const PUSHED_EVENTS = ['friend_request', 'friend_accepted', 'added_to_group', 'made_admin', 'reaction']

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

interface NotificationRecord {
  id: string
  user_id: string
  actor_id: string
  kind: string
  conversation_id: string | null
  message_id: string | null
  emoji: string | null
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

/** The bell's wording, in English; the service worker rewrites it in the device's language. */
function describe(kind: string, actor: string, group: string | null, emoji: string | null) {
  switch (kind) {
    case 'friend_request':
      return `${actor} sent you a friend request`
    case 'friend_accepted':
      return `${actor} accepted your friend request`
    case 'added_to_group':
      return `${actor} added you to ${group}`
    case 'made_admin':
      return `${actor} made you an admin of ${group}`
    default:
      return `${actor} reacted ${emoji} to your message`
  }
}

/** Sends each person's own body to all their devices, and forgets devices that are gone. */
async function deliver(userIds: string[], bodyFor: (userId: string) => Promise<string>) {
  const { data: subscriptions } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)
  if (!subscriptions?.length) return Response.json({ sent: 0 })

  const bodies = new Map<string, string>()
  for (const userId of new Set(subscriptions.map((s) => s.user_id))) bodies.set(userId, await bodyFor(userId))

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
}

async function onMessage(m: MessageRecord) {
  // Everyone in the conversation except the sender, minus people who muted it (unless
  // they're @mentioned) or haven't accepted it yet (a message request from a stranger).
  const { data: recipients, error } = await admin.rpc('push_recipients', {
    conv_id: m.conversation_id,
    sender: m.sender_id,
    mentioned: m.mentions ?? [],
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!recipients?.length) return Response.json({ sent: 0 })

  const [{ data: sender }, { data: conversation }] = await Promise.all([
    admin.from('profiles').select('full_name, avatar_url').eq('id', m.sender_id).single(),
    admin.from('conversations').select('is_group, name, avatar_url').eq('id', m.conversation_id).single(),
  ])

  const notification = {
    title: conversation?.is_group ? `${sender?.full_name} · ${conversation.name}` : (sender?.full_name ?? APP_NAME),
    body: preview(m),
    icon: (conversation?.is_group ? conversation.avatar_url : sender?.avatar_url) ?? APP_ICON,
    conversationId: m.conversation_id,
    // One notification per chat: a newer message replaces the older one.
    tag: m.conversation_id,
  }

  // The same notification for everyone, except each person's own "Mark as read" token.
  return deliver(recipients, async (userId) => {
    const action = ACTION_SECRET
      ? { url: ACTION_URL, token: await signActionToken(ACTION_SECRET, { c: m.conversation_id, u: userId }) }
      : undefined
    return JSON.stringify({ ...notification, action })
  })
}

async function onNotification(n: NotificationRecord) {
  if (!PUSHED_EVENTS.includes(n.kind)) return Response.json({ skipped: true })

  const [{ data: actor }, { data: conversation }, { data: membership }] = await Promise.all([
    admin.from('profiles').select('full_name, avatar_url').eq('id', n.actor_id).single(),
    n.conversation_id
      ? admin.from('conversations').select('name').eq('id', n.conversation_id).single()
      : Promise.resolve({ data: null }),
    n.conversation_id
      ? admin
          .from('conversation_participants')
          .select('muted')
          .eq('conversation_id', n.conversation_id)
          .eq('user_id', n.user_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  // A reaction in a chat you muted stays in the bell, without a pop-up.
  if (n.kind === 'reaction' && membership?.muted) return Response.json({ skipped: true })

  const actorName = actor?.full_name ?? APP_NAME
  const groupName = conversation?.name ?? null
  const friends = n.kind === 'friend_request' || n.kind === 'friend_accepted'
  const body = JSON.stringify({
    title: APP_NAME,
    body: describe(n.kind, actorName, groupName, n.emoji),
    icon: actor?.avatar_url ?? APP_ICON,
    // One per person and kind (friends), or per chat and kind.
    tag: `${n.kind}:${n.conversation_id ?? n.actor_id}`,
    conversationId: friends ? undefined : (n.conversation_id ?? undefined),
    path: friends ? '/friends' : undefined,
    event: { kind: n.kind, actor: actorName, group: groupName, emoji: n.emoji },
  })
  return deliver([n.user_id], () => Promise.resolve(body))
}

Deno.serve(async (req) => {
  // Only the database webhooks know this secret.
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 })

  const payload = await req.json()
  if (payload?.type !== 'INSERT' || !payload?.record) return Response.json({ skipped: true })
  if (payload.table === 'messages') return onMessage(payload.record as MessageRecord)
  if (payload.table === 'notifications') return onNotification(payload.record as NotificationRecord)
  return Response.json({ skipped: true })
})
