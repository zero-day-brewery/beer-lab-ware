/**
 * Service-worker /state bypass — regression guard.
 *
 * The SW must NOT intercept `/state` (the Track B sync endpoint). If it ever did,
 * a cached (esp. 204/empty) response would make every future pull read stale/null
 * and silently poison sync. This loads the real public/sw.js via the shared
 * node:vm harness (sw-harness.ts — controlled SW globals), captures its fetch
 * listener, and asserts `/state` passes straight through (no respondWith) while
 * a normal same-origin GET IS handled. Broader strategy coverage lives in
 * sw-behavior.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { fetchEvent, loadSw } from './sw-harness'

describe('sw /state bypass', () => {
  it('does NOT intercept GET /state (network-only)', () => {
    const { onFetch } = loadSw()
    const { event, respondWith } = fetchEvent('https://brew.example/state')
    onFetch(event)
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('does NOT intercept a /state subpath', () => {
    const { onFetch } = loadSw()
    const { event, respondWith } = fetchEvent('https://brew.example/state/anything')
    onFetch(event)
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('DOES handle a normal same-origin GET (so caching still works)', () => {
    const { onFetch } = loadSw()
    const { event, respondWith } = fetchEvent('https://brew.example/recipes/')
    onFetch(event)
    expect(respondWith).toHaveBeenCalled()
  })
})

describe('sw /state bypass under a subpath deploy (BASE from registration scope)', () => {
  const SCOPE = 'https://brew.example/beer-lab-ware/'

  it('does NOT intercept GET <base>/state', () => {
    const { onFetch } = loadSw({ scope: SCOPE })
    const { event, respondWith } = fetchEvent('https://brew.example/beer-lab-ware/state')
    onFetch(event)
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('does NOT intercept a <base>/state subpath', () => {
    const { onFetch } = loadSw({ scope: SCOPE })
    const { event, respondWith } = fetchEvent('https://brew.example/beer-lab-ware/state/anything')
    onFetch(event)
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('DOES handle a normal in-scope GET under the subpath', () => {
    const { onFetch } = loadSw({ scope: SCOPE })
    const { event, respondWith } = fetchEvent('https://brew.example/beer-lab-ware/recipes/')
    onFetch(event)
    expect(respondWith).toHaveBeenCalled()
  })

  it('survives a missing self.registration (falls back to root base)', () => {
    // The harness always provides a registration; simulate absence by passing
    // an invalid scope so the URL parse throws inside the SW.
    const { onFetch } = loadSw({ scope: 'not a url' })
    const { event, respondWith } = fetchEvent('https://brew.example/state')
    onFetch(event)
    expect(respondWith).not.toHaveBeenCalled()
  })
})
