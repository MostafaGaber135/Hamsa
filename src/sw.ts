/// <reference lib="webworker" />
// Hamsa's service worker (built by vite-plugin-pwa, "injectManifest"):
// - keeps the app itself (HTML, JS, CSS, fonts, icons) so Hamsa opens without a connection
// - receives photos and files shared to Hamsa from other apps (Web Share Target)
// - shows push notifications, with "Reply" and "Mark as read" buttons
// Data (chats, messages) is never cached here: that's the app's IndexedDB cache.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { set } from 'idb-keyval'
import { SHARE_STORAGE_KEY, type SharedItems } from './features/share/storage'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0] }

/** For a push without its own title or icon. */
const APP_NAME = 'Hamsa'
const APP_ICON = '/icons/icon-192.png'
/** The small monochrome icon in the status bar (Android). */
const BADGE_ICON = '/icons/badge-72.png'
/** "See other": after the shared POST, the browser loads /share with a GET. */
const SEE_OTHER = 303

// ---- The app shell ----
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
// Every page is the same single-page app: /, /c/<id>, /friends, /privacy…
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// A new version waits until the app says "reload now" (the update prompt).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// ---- "Share to Hamsa" from another app ----
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return
  event.respondWith(
    (async () => {
      const form = await event.request.formData()
      const text = ['title', 'text', 'url']
        .map((field) => form.get(field))
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
        .join('\n')
      const files = form.getAll('files').filter((file): file is File => file instanceof File && file.size > 0)
      const shared: SharedItems = { text, files, at: Date.now() }
      await set(SHARE_STORAGE_KEY, shared)
      // The app picks it up on /share, where you choose the chat.
      return Response.redirect('/share', SEE_OTHER)
    })(),
  )
})

// ---- Notifications ----
interface PushData {
  title?: string
  body?: string
  icon?: string
  tag?: string
  conversationId?: string
  /** Where a tap leads when it isn't a chat, e.g. "/friends". */
  path?: string
  /** A bell event (friend request, reaction…), worded here in the device's language. */
  event?: { kind: string; actor: string; group: string | null; emoji: string | null }
  /** Lets "Mark as read" work without opening the app (see the notification-action function). */
  action?: { url: string; token: string }
}

const isArabic = () => self.navigator.language.startsWith('ar')
const labels = () => (isArabic() ? { reply: 'رد', read: 'تعليم كمقروءة' } : { reply: 'Reply', read: 'Mark as read' })

/** The bell's wording, as in the app (src/lib/i18n): "Sara reacted ❤️ to your message". */
function eventText({ kind, actor, group, emoji }: NonNullable<PushData['event']>): string | undefined {
  const ar = isArabic()
  switch (kind) {
    case 'friend_request':
      return ar ? `أرسل ${actor} لك طلب صداقة` : `${actor} sent you a friend request`
    case 'friend_accepted':
      return ar ? `قبل ${actor} طلب صداقتك` : `${actor} accepted your friend request`
    case 'added_to_group':
      return ar ? `أضافك ${actor} إلى ${group}` : `${actor} added you to ${group}`
    case 'made_admin':
      return ar ? `جعلك ${actor} مشرفًا في ${group}` : `${actor} made you an admin of ${group}`
    case 'reaction':
      return ar ? `تفاعل ${actor} بـ ${emoji} مع رسالتك` : `${actor} reacted ${emoji} to your message`
  }
}

self.addEventListener('push', (event) => {
  const data: PushData = event.data ? event.data.json() : {}

  event.waitUntil(
    (async () => {
      // Already looking at Hamsa? The message appears live in the app, no pop-up needed.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return

      const text = labels()
      await self.registration.showNotification(data.title || APP_NAME, {
        body: (data.event && eventText(data.event)) || data.body || '',
        icon: data.icon || APP_ICON,
        badge: BADGE_ICON,
        tag: data.tag,
        // renotify isn't in TypeScript's NotificationOptions yet.
        ...{ renotify: Boolean(data.tag) },
        dir: 'auto',
        data,
        // Reply and Mark as read are for messages; a bell event just opens.
        actions: data.event
          ? []
          : [{ action: 'reply', title: text.reply }, ...(data.action ? [{ action: 'read', title: text.read }] : [])],
      } as NotificationOptions)
      // A dot on the app icon until Hamsa is opened (the app then shows the real count).
      await self.navigator.setAppBadge?.().catch(() => undefined)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = (event.notification.data ?? {}) as PushData

  // "Mark as read": done in the background, without opening Hamsa.
  if (event.action === 'read' && data.action) {
    const { url, token } = data.action
    event.waitUntil(
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
        .then(() => undefined)
        .catch(() => undefined),
    )
    return
  }

  // "Reply" or a tap on the notification: open that chat (or page), reusing an open Hamsa tab.
  const conversationId = data.conversationId
  const path = conversationId ? `/c/${conversationId}` : (data.path ?? '/')
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) {
        if ('focus' in w) {
          w.postMessage(conversationId ? { type: 'open-conversation', conversationId } : { type: 'open-path', path })
          return w.focus()
        }
      }
      return self.clients.openWindow(path)
    })(),
  )
})
