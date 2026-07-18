/**
 * Service-worker behavior coverage — the 81-line offline engine end to end.
 *
 * public/sw.js is what keeps the app usable with the network down, so every
 * strategy it implements is pinned here against the REAL committed file (loaded
 * via the shared node:vm harness, precache injected exactly like
 * scripts/gen-sw-precache.mjs does at build time):
 *
 *   - install: opens the versioned precache, cache.add()s every PRECACHE
 *     entry, and calls skipWaiting().
 *   - activate: deletes every stale cache version, keeps the current one, and
 *     claims open clients.
 *   - fetch: /_next/static/* is cache-first (no network when cached; fetched
 *     and written back when not); navigations are cached-first with a network
 *     fallback chain to BASE + '/' and finally a 503 offline response; non-GET
 *     and cross-origin requests are never intercepted.
 *
 * Every check runs twice: at an origin-root scope and at a subpath scope
 * ('/beer-lab-ware'), locking the BASE-derivation behavior for both deploys.
 */

import { describe, expect, it } from 'vitest'
import { fetchEvent, flushMicrotasks, lifecycleEvent, loadSw } from './sw-harness'

const VERSION = 'beer-lab-ware-test0001'

const SCOPES = [
  { label: 'root scope', scope: 'https://brew.example/', base: '' },
  { label: 'subpath scope', scope: 'https://x.example/beer-lab-ware/', base: '/beer-lab-ware' },
] as const

for (const { label, scope, base } of SCOPES) {
  const origin = new URL(scope).origin
  // Shaped like gen-sw-precache output: directory URLs for pages, base-prefixed.
  const precache = [
    { url: `${base}/`, revision: 'aaaa1111' },
    { url: `${base}/calculators/`, revision: 'bbbb2222' },
    { url: `${base}/_next/static/chunks/app.js`, revision: 'cccc3333' },
  ]

  describe(`sw install (${label})`, () => {
    it('opens the versioned precache and cache.add()s every PRECACHE entry', async () => {
      const sw = loadSw({ scope, precache, version: VERSION })
      const { event, settled } = lifecycleEvent()
      sw.onInstall(event)
      await settled()

      expect(sw.caches.open).toHaveBeenCalledWith(VERSION)
      const cache = sw.cacheStore.get(VERSION)
      expect(cache).toBeDefined()
      for (const entry of precache) {
        expect(cache?.add).toHaveBeenCalledWith(entry.url)
      }
      expect(cache?.add).toHaveBeenCalledTimes(precache.length)
    })

    it('calls skipWaiting()', () => {
      const sw = loadSw({ scope, precache, version: VERSION })
      const { event } = lifecycleEvent()
      sw.onInstall(event)
      expect(sw.skipWaiting).toHaveBeenCalledTimes(1)
    })
  })

  describe(`sw activate (${label})`, () => {
    it('deletes stale cache versions, keeps the current one, claims clients', async () => {
      const sw = loadSw({ scope, precache, version: VERSION })
      sw.seedCache('beer-lab-ware-old00001', `${base}/`, new Response('stale'))
      sw.seedCache(VERSION, `${base}/`, new Response('current'))
      sw.seedCache('beer-lab-ware-old00002', `${base}/calculators/`, new Response('stale'))

      const { event, settled } = lifecycleEvent()
      sw.onActivate(event)
      await settled()

      expect(sw.caches.delete).toHaveBeenCalledWith('beer-lab-ware-old00001')
      expect(sw.caches.delete).toHaveBeenCalledWith('beer-lab-ware-old00002')
      expect(sw.caches.delete).not.toHaveBeenCalledWith(VERSION)
      expect([...sw.cacheStore.keys()]).toEqual([VERSION])
      expect(sw.clientsClaim).toHaveBeenCalledTimes(1)
    })
  })

  describe(`sw fetch: /_next/static cache-first (${label})`, () => {
    const asset = `${origin}${base}/_next/static/chunks/app.js`

    it('returns the cached response without touching the network', async () => {
      const sw = loadSw({ scope, version: VERSION })
      const cached = new Response('cached-chunk')
      sw.seedCache(VERSION, asset, cached)

      const { event, respondWith, response } = fetchEvent(asset)
      sw.onFetch(event)

      expect(respondWith).toHaveBeenCalledTimes(1)
      expect(await response()).toBe(cached)
      expect(sw.fetchMock).not.toHaveBeenCalled()
    })

    it('fetches and writes back to the versioned cache when absent', async () => {
      const fresh = new Response('fresh-chunk')
      const sw = loadSw({ scope, version: VERSION, fetchImpl: async () => fresh })

      const { event, response } = fetchEvent(asset)
      sw.onFetch(event)

      expect(await response()).toBe(fresh)
      expect(sw.fetchMock).toHaveBeenCalledTimes(1)
      await flushMicrotasks()
      const cache = sw.cacheStore.get(VERSION)
      expect(cache?.put).toHaveBeenCalledTimes(1)
      expect(cache?.entries.has(asset)).toBe(true)
    })
  })

  describe(`sw fetch: navigations (${label})`, () => {
    const pageUrl = `${origin}${base}/calculators/`

    it('serves the cached page first (stale-while-revalidate still hits network)', async () => {
      const sw = loadSw({ scope, version: VERSION })
      const cached = new Response('cached-page')
      sw.seedCache(VERSION, pageUrl, cached)

      const { event, response } = fetchEvent(pageUrl, { mode: 'navigate' })
      sw.onFetch(event)

      expect(await response()).toBe(cached)
      expect(sw.fetchMock).toHaveBeenCalledTimes(1)
    })

    it('falls back to the network when not cached, and caches the result', async () => {
      const fresh = new Response('network-page')
      const sw = loadSw({ scope, version: VERSION, fetchImpl: async () => fresh })

      const { event, response } = fetchEvent(pageUrl, { mode: 'navigate' })
      sw.onFetch(event)

      expect(await response()).toBe(fresh)
      await flushMicrotasks()
      expect(sw.cacheStore.get(VERSION)?.entries.has(pageUrl)).toBe(true)
    })

    it("falls back to the cached BASE + '/' shell when the network is down", async () => {
      const sw = loadSw({ scope, version: VERSION })
      const shell = new Response('app-shell')
      sw.seedCache(VERSION, `${base}/`, shell)

      const { event, response } = fetchEvent(pageUrl, { mode: 'navigate' })
      sw.onFetch(event)

      expect(await response()).toBe(shell)
    })

    it('answers a 503 offline response when nothing is cached at all', async () => {
      const sw = loadSw({ scope, version: VERSION })

      const { event, response } = fetchEvent(pageUrl, { mode: 'navigate' })
      sw.onFetch(event)

      const res = await response()
      expect(res?.status).toBe(503)
      expect(res?.headers.get('Content-Type')).toBe('text/plain')
      expect(await res?.text()).toBe('Offline')
    })
  })

  describe(`sw fetch: pass-through (${label})`, () => {
    it('never intercepts non-GET requests', () => {
      const sw = loadSw({ scope, version: VERSION })
      const { event, respondWith } = fetchEvent(`${origin}${base}/state`, { method: 'POST' })
      sw.onFetch(event)
      expect(respondWith).not.toHaveBeenCalled()
    })

    it('never intercepts cross-origin requests', () => {
      const sw = loadSw({ scope, version: VERSION })
      const { event, respondWith } = fetchEvent('https://other.example/analytics.js')
      sw.onFetch(event)
      expect(respondWith).not.toHaveBeenCalled()
    })
  })
}
