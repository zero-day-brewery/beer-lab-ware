/**
 * Shared harness for testing the REAL committed public/sw.js.
 *
 * Loads the service worker inside a sandboxed `node:vm` context with controlled
 * SW globals (registration scope, CacheStorage, fetch, clients) and returns its
 * captured lifecycle listeners plus spies over every side-effect surface. The
 * PRECACHE / PRECACHE_VERSION placeholders can be injected with the exact same
 * string replacement scripts/gen-sw-precache.mjs performs at build time, so
 * tests exercise the file the way production ships it.
 *
 * (vm, not new Function: sandboxed evaluation of OUR OWN committed sw.js with
 * controlled globals and no access to the host scope — no code-injection
 * surface.)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { vi } from 'vitest'

export interface PrecacheEntry {
  url: string
  revision: string
}

interface LifecycleEvent {
  waitUntil: (p: unknown) => void
}
type LifecycleListener = (event: LifecycleEvent) => void

export interface SwRequest {
  method: string
  url: string
  mode: string
}
interface SwFetchEvent {
  request: SwRequest
  respondWith: (r: unknown) => void
}
type FetchListener = (event: SwFetchEvent) => void

export type SwHarness = ReturnType<typeof loadSw>

const DEFAULT_SCOPE = 'https://brew.example/'

function must<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`sw.js did not register a '${name}' listener`)
  return value
}

export function loadSw(
  options: {
    scope?: string
    precache?: PrecacheEntry[]
    version?: string
    fetchImpl?: (req: SwRequest) => Promise<Response>
  } = {},
) {
  const scope = options.scope ?? DEFAULT_SCOPE
  let origin = 'https://brew.example'
  try {
    origin = new URL(scope).origin
  } catch {
    // An unparsable scope is itself a supported test case: sw.js catches the
    // URL parse failure and falls back to the root base.
  }

  let src = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')
  if (options.precache) {
    // Same replacement scripts/gen-sw-precache.mjs runs at build time.
    src = src.replace('/*__PRECACHE__*/[]/*__END__*/', JSON.stringify(options.precache))
  }
  if (options.version) {
    src = src.replace("'__VERSION__'", JSON.stringify(options.version))
  }

  // Cache keys are full URLs; sw.js mixes Request objects and path strings
  // (`caches.match(req)` vs `caches.match(BASE + '/')`), so normalize both.
  const toKey = (target: unknown): string => {
    const url = typeof target === 'string' ? target : (target as SwRequest).url
    return url.startsWith('/') ? `${origin}${url}` : url
  }

  const makeCache = () => {
    const entries = new Map<string, Response>()
    return {
      entries,
      add: vi.fn(async (url: string) => {
        entries.set(toKey(url), new Response(`precached ${url}`))
      }),
      put: vi.fn(async (req: unknown, res: Response) => {
        entries.set(toKey(req), res)
      }),
    }
  }
  type FakeCache = ReturnType<typeof makeCache>

  const cacheStore = new Map<string, FakeCache>()
  const openCache = (name: string): FakeCache => {
    let cache = cacheStore.get(name)
    if (!cache) {
      cache = makeCache()
      cacheStore.set(name, cache)
    }
    return cache
  }

  const caches = {
    open: vi.fn(async (name: string) => openCache(name)),
    keys: vi.fn(async () => [...cacheStore.keys()]),
    delete: vi.fn(async (name: string) => cacheStore.delete(name)),
    match: vi.fn(async (target: unknown) => {
      const key = toKey(target)
      for (const cache of cacheStore.values()) {
        const hit = cache.entries.get(key)
        if (hit) return hit
      }
      return undefined
    }),
  }

  const skipWaiting = vi.fn()
  const clientsClaim = vi.fn()
  const fetchMock = vi.fn(
    options.fetchImpl ?? ((_req: SwRequest) => Promise.reject(new Error('no network in test'))),
  )

  const listeners: {
    install?: LifecycleListener
    activate?: LifecycleListener
    fetch?: FetchListener
  } = {}

  const sandbox = {
    self: {
      addEventListener: (type: string, handler: unknown) => {
        ;(listeners as Record<string, unknown>)[type] = handler
      },
      skipWaiting,
      clients: { claim: clientsClaim },
      registration: { scope },
    },
    location: { origin },
    caches,
    fetch: fetchMock,
    URL,
    Promise,
    Response,
  }
  runInContext(src, createContext(sandbox))

  return {
    onInstall: must(listeners.install, 'install'),
    onActivate: must(listeners.activate, 'activate'),
    onFetch: must(listeners.fetch, 'fetch'),
    caches,
    cacheStore,
    seedCache: (cacheName: string, url: string, response: Response) => {
      openCache(cacheName).entries.set(toKey(url), response)
    },
    skipWaiting,
    clientsClaim,
    fetchMock,
    origin,
  }
}

/** An ExtendableEvent double: capture the waitUntil promise so tests can await it. */
export function lifecycleEvent() {
  let pending: unknown
  const event: LifecycleEvent = {
    waitUntil: (p: unknown) => {
      pending = p
    },
  }
  return { event, settled: () => Promise.resolve(pending) }
}

/** A FetchEvent double: respondWith spy + an awaitable handle on the response. */
export function fetchEvent(url: string, init: { method?: string; mode?: string } = {}) {
  let responded: unknown
  const respondWith = vi.fn((r: unknown) => {
    responded = r
  })
  const event: SwFetchEvent = {
    request: { method: init.method ?? 'GET', url, mode: init.mode ?? 'cors' },
    respondWith,
  }
  return {
    event,
    respondWith,
    response: () => Promise.resolve(responded) as Promise<Response | undefined>,
  }
}

/**
 * Drain the microtask queue. fetchAndCache's cache.put happens in a promise
 * chain that respondWith does NOT wait on, so tests must flush before
 * asserting the write landed.
 */
export async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
