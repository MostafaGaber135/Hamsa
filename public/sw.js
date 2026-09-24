// Hamsa service worker: shows push notifications and opens the right chat when one is clicked.
// It deliberately has no fetch handler, so it never caches or changes how the app loads.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}

  event.waitUntil(
    (async () => {
      // Already looking at Hamsa? The message appears live in the app, no pop-up needed.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return

      await self.registration.showNotification(data.title || 'Hamsa', {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: data.tag,
        renotify: Boolean(data.tag),
        dir: 'auto',
        data: { conversationId: data.conversationId },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const conversationId = event.notification.data && event.notification.data.conversationId

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Reuse an open Hamsa tab if there is one.
      for (const w of windows) {
        if ('focus' in w) {
          w.postMessage({ type: 'open-conversation', conversationId })
          return w.focus()
        }
      }
      return self.clients.openWindow(conversationId ? `/?c=${conversationId}` : '/')
    })(),
  )
})
