/**
 * Service-worker /state bypass — regression guard.
 *
 * The SW must NOT intercept `/state` (the Track B sync endpoint). If it ever did,
 * a cached (esp. 204/empty) response would make every future pull read stale/null
 * and silently poison sync. This loads the real public/sw.js inside a sandboxed
 * `node:vm` context (controlled SW globals), captures its fetch listener, and
 * asserts `/state` passes straight through (no respondWith) while a normal
 * same-origin GET IS handled.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type FetchListener = (event: { request: unknown; respondWith: (r: unknown) => void }) => void

function loadSwFetchListener(): FetchListener {
  const src = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')
  const listeners: Record<string, FetchListener> = {}
  const sandbox = {
    self: {
      addEventListener: (type: string, handler: FetchListener) => {
        listeners[type] = handler
      },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    location: { origin: 'https://brew.example' },
    caches: {
      open: async () => ({ add: () => {}, put: () => {} }),
      keys: async () => [],
      match: async () => undefined,
      delete: () => {},
    },
    fetch: () => Promise.reject(new Error('no network in test')),
    URL,
    Promise,
    Response,
  }
  // Sandboxed evaluation of OUR OWN committed sw.js — controlled globals, no
  // access to the host scope. (vm, not new Function: no code-injection surface.)
  runInContext(src, createContext(sandbox))
  return listeners.fetch
}

function fetchEvent(url: string, method = 'GET', mode = 'cors') {
  const respondWith = vi.fn()
  const event = { request: { method, url, mode }, respondWith }
  return { event, respondWith }
}

describe('sw /state bypass', () => {
  it('does NOT intercept GET /state (network-only)', () => {
    const onFetch = loadSwFetchListener()
    const { event, respondWith } = fetchEvent('https://brew.example/state')
    onFetch(event)
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('does NOT intercept a /state subpath', () => {
    const onFetch = loadSwFetchListener()
    const { event, respondWith } = fetchEvent('https://brew.example/state/anything')
    onFetch(event)
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('DOES handle a normal same-origin GET (so caching still works)', () => {
    const onFetch = loadSwFetchListener()
    const { event, respondWith } = fetchEvent('https://brew.example/recipes/')
    onFetch(event)
    expect(respondWith).toHaveBeenCalled()
  })
})
