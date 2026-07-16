import { expect, test } from '@playwright/test'

// Non-blocking: run via `--grep-invert @nonblocking` for the required gate; SW nondeterminism must not fail CI.
test.describe('@nonblocking pwa / service worker', () => {
  test.use({ serviceWorkers: 'allow' })

  test('manifest + service worker are shipped and reachable', async ({ page, request }) => {
    await page.goto('/')
    const manifest = await request.get('/manifest.webmanifest')
    expect(manifest.ok()).toBeTruthy()
    const sw = await request.get('/sw.js')
    expect(sw.ok()).toBeTruthy()
  })

  test('service worker registers where supported', async ({ page, browserName }) => {
    test.skip(
      browserName === 'webkit',
      'WebKit ≠ shipping Safari; assert prerequisites only, not registration',
    )
    await page.goto('/')
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      const reg = await navigator.serviceWorker.getRegistration()
      return !!reg || (await navigator.serviceWorker.ready.then(() => true).catch(() => false))
    })
    expect(registered).toBeTruthy()
  })
})
