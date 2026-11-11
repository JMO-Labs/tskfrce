// Offline shell only: never caches pages, API responses or family data.
const CACHE = 't4ce-shell-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/offline.html', '/icons/icon-192.png'])))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Page loads only; /api/* and /ws/* never match. On a network error show the offline page.
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')))
})

// Tapping a notification (e.g. the kid's "Internet is paused") focuses or opens the kid screen.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/kid'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs.find((w) => w.url.includes(url))
      return c ? c.focus() : self.clients.openWindow(url)
    }),
  )
})
