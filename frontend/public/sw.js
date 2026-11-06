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
