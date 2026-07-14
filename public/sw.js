// Service worker for Beer-Lab-Ware.
// PRECACHE + PRECACHE_VERSION are injected at build time by
// scripts/gen-sw-precache.mjs (postbuild). The committed placeholders keep this
// file valid JS for dev. The prod-only registration guard lives in
// service-worker-register.tsx (dev unregisters + drops caches) — unchanged.
const PRECACHE = /*__PRECACHE__*/[]/*__END__*/
const PRECACHE_VERSION = '__VERSION__'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE_VERSION)
      .then((cache) => Promise.allSettled(PRECACHE.map((e) => cache.add(e.url)))),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== PRECACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

function fetchAndCache(req) {
  return fetch(req).then((res) => {
    if (res.ok) {
      const clone = res.clone()
      caches.open(PRECACHE_VERSION).then((cache) => cache.put(req, clone))
    }
    return res
  })
}

function offline() {
  return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // Track B sync endpoint: NEVER cache /state. It's the live canonical brewery
  // state; a cached (esp. 204/empty) response would make every future pull read
  // stale/null and silently poison sync. Pass straight through to the network.
  if (url.pathname === '/state' || url.pathname.startsWith('/state/')) return

  // Immutable hashed chunks → cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(caches.match(req).then((cached) => cached ?? fetchAndCache(req)))
    return
  }

  // Navigations → stale-while-revalidate; fall back to cached "/" then a
  // precached offline page (never a bare 503 with no body).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetchAndCache(req).catch(() =>
          caches.match('/').then((c) => c ?? offline()),
        )
        return cached ?? network
      }),
    )
    return
  }

  // Everything else same-origin → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetchAndCache(req).catch(() => cached ?? offline())
      return cached ?? network
    }),
  )
})
