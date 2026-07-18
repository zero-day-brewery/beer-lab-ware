import { expect, test } from '@playwright/test'

// Offline PWA smoke: the served out/ is a production build, so sw.js registers
// naturally (service-worker-register.tsx) — this file overrides the global
// `serviceWorkers: 'block'` to let it, waits for the precache to be genuinely
// populated, then cuts the network and proves the app shell still boots and
// navigates from cache.
test.use({ serviceWorkers: 'allow' })

test.describe('offline pwa', () => {
  test('app shell renders and navigates with the network down', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      'WebKit ≠ shipping Safari; offline SW behavior is asserted on chromium only',
    )

    await page.goto('/')

    // Wait for the SW to be ACTIVATED + controlling (claim ran — the same gate
    // navigator.serviceWorker.ready resolves on) and for the precache to hold
    // both routes this test loads offline. Install precaches everything via
    // Promise.allSettled, so polling for these two entries is sufficient.
    // expect.poll + evaluate, NOT waitForFunction: waitForFunction does not
    // reliably await an async predicate, and going offline before activation
    // hard-fails the reload with ERR_INTERNET_DISCONNECTED.
    // Generous but bounded: the localhost precache fills in a few seconds.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return 'no-sw-support'
            const reg = await navigator.serviceWorker.getRegistration()
            if (reg?.active?.state !== 'activated') return 'not-activated'
            if (!navigator.serviceWorker.controller) return 'not-controlling'
            const keys = await caches.keys()
            const name = keys.find((k) => k.startsWith('beer-lab-ware-'))
            if (!name) return 'no-precache'
            const cache = await caches.open(name)
            const shell = await cache.match('/')
            const calc = await cache.match('/calculators/')
            return shell && calc ? 'ready' : 'precache-incomplete'
          }),
        { timeout: 30_000, message: 'service worker activated + precache populated' },
      )
      .toBe('ready')

    await context.setOffline(true)
    try {
      // (1) Hard reload offline → the navigation and its /_next/static chunks
      // are served from the precache; the sidebar brand proves hydration.
      // (The mobile-header brand span is display-hidden at the default desktop
      // viewport, so target the sidebar's brand link specifically.)
      await page.reload()
      await expect(
        page.getByRole('complementary', { name: 'Primary' }).getByRole('link', {
          name: 'Beer-Lab-Ware',
        }),
      ).toBeVisible()

      // (2) A second route, straight from cache.
      await page.goto('/calculators/')
      await expect(page.getByRole('heading', { name: 'Calculators', level: 1 })).toBeVisible()

      // (3) Anchor that the network is REALLY down for this page: an uncached
      // same-origin GET must come back as the SW's synthesized 503 offline
      // response (online it would be the static server's 404 instead).
      const probe = await page.evaluate(async () => {
        try {
          const res = await fetch('/not-precached-offline-probe.txt')
          return { fetched: true, status: res.status, body: await res.text() }
        } catch {
          return { fetched: false, status: 0, body: '' }
        }
      })
      expect(probe.fetched).toBe(true)
      expect(probe.status).toBe(503)
      expect(probe.body).toBe('Offline')
    } finally {
      await context.setOffline(false)
    }
  })
})
