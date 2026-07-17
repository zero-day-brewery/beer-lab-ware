/**
 * Sync connection helpers: URL validation (https-required policy), the
 * /health compatibility check, the HEAD-less auth probe (status only — never
 * downloads the state body), and the human error mapping (never token
 * material).
 */
import { describe, expect, it, vi } from 'vitest'
import { DUMP_VERSION } from '@/lib/db/backup'
import { SyncPushConflictError } from '@/lib/sync/sync-client'
import {
  checkSyncHealth,
  describeSyncError,
  probeSyncAuth,
  validateServerUrl,
} from '@/lib/sync/sync-config'
import { SyncHttpError } from '@/lib/sync/transport'

describe('validateServerUrl', () => {
  it('accepts https:// anywhere and normalizes trailing slashes', () => {
    expect(validateServerUrl('https://brewery.example.com/')).toEqual({
      ok: true,
      url: 'https://brewery.example.com',
    })
  })

  it('keeps a subpath (reverse-proxy prefix deploys)', () => {
    expect(validateServerUrl('https://home.example.com/brew/')).toEqual({
      ok: true,
      url: 'https://home.example.com/brew',
    })
  })

  it('accepts http:// ONLY for loopback hosts', () => {
    expect(validateServerUrl('http://localhost:8787').ok).toBe(true)
    expect(validateServerUrl('http://127.0.0.1:8787').ok).toBe(true)
    expect(validateServerUrl('http://[::1]:8787').ok).toBe(true)
  })

  it('rejects http:// for any non-loopback host, and says why', () => {
    const r = validateServerUrl('http://sync.example.com')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/https:\/\/ required/i)
  })

  it('rejects an unparseable URL, a non-http(s) scheme, URL credentials, and query/fragment', () => {
    expect(validateServerUrl('not a url').ok).toBe(false)
    expect(validateServerUrl('ftp://example.com').ok).toBe(false)
    expect(validateServerUrl('https://user:pw@example.com').ok).toBe(false)
    expect(validateServerUrl('https://example.com/?x=1').ok).toBe(false)
    expect(validateServerUrl('https://example.com/#frag').ok).toBe(false)
    expect(validateServerUrl('').ok).toBe(false)
  })
})

function healthResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('checkSyncHealth', () => {
  it('reports compatible when the daemon supports the version this app writes', async () => {
    const fetchImpl = vi.fn(async () =>
      healthResponse({
        ok: true,
        daemonVersion: '0.1.0',
        supportedDumpVersions: [1, 2, 3, 4, 5, 6, 7, 8, DUMP_VERSION],
      }),
    ) as unknown as typeof fetch
    const r = await checkSyncHealth('https://x.example.com/', fetchImpl)
    expect(r).toMatchObject({ ok: true, daemonVersion: '0.1.0', compatible: true })
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://x.example.com/health',
    )
  })

  it('reports incompatible + the max the server accepts when the daemon is older', async () => {
    const fetchImpl = vi.fn(async () =>
      healthResponse({ ok: true, daemonVersion: '0.0.9', supportedDumpVersions: [1, 2, 3, 8] }),
    ) as unknown as typeof fetch
    const r = await checkSyncHealth('https://x.example.com', fetchImpl)
    expect(r).toMatchObject({ ok: true, compatible: false, maxSupported: 8 })
  })

  it('maps a network failure, a non-2xx, a non-JSON body, and a wrong shape to ok:false with a reason', async () => {
    const boom = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect((await checkSyncHealth('https://x.example.com', boom)).ok).toBe(false)

    const not200 = vi.fn(
      async () => new Response('nope', { status: 502 }),
    ) as unknown as typeof fetch
    expect((await checkSyncHealth('https://x.example.com', not200)).ok).toBe(false)

    const notJson = vi.fn(
      async () => new Response('<html>', { status: 200 }),
    ) as unknown as typeof fetch
    expect((await checkSyncHealth('https://x.example.com', notJson)).ok).toBe(false)

    const wrongShape = vi.fn(async () =>
      healthResponse({ hello: 'world' }),
    ) as unknown as typeof fetch
    expect((await checkSyncHealth('https://x.example.com', wrongShape)).ok).toBe(false)
  })
})

/** A Response whose body records whether it was cancelled vs read. */
function stateResponse(status: number): { res: Response; wasCancelled: () => boolean } {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"tables":{}}'))
    },
    cancel() {
      cancelled = true
    },
  })
  const res = new Response(status === 204 ? null : stream, { status })
  return { res, wasCancelled: () => cancelled }
}

describe('probeSyncAuth', () => {
  it('returns ok on 200 and CANCELS the body instead of downloading the state', async () => {
    const { res, wasCancelled } = stateResponse(200)
    const fetchImpl = vi.fn(async () => res) as unknown as typeof fetch
    expect(await probeSyncAuth('https://x.example.com', 'tok', fetchImpl)).toBe('ok')
    expect(wasCancelled()).toBe(true)
  })

  it('returns ok on 204 (empty store, auth accepted)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch
    expect(await probeSyncAuth('https://x.example.com', 'tok', fetchImpl)).toBe('ok')
  })

  it('returns unauthorized on 401, error on other statuses, unreachable on network failure', async () => {
    const r401 = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    expect(await probeSyncAuth('https://x.example.com', 'tok', r401)).toBe('unauthorized')

    const r500 = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    expect(await probeSyncAuth('https://x.example.com', 'tok', r500)).toBe('error')

    const boom = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await probeSyncAuth('https://x.example.com', 'tok', boom)).toBe('unreachable')
  })

  it('sends the Bearer token on the probe request', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    )
    await probeSyncAuth('https://x.example.com', 'tok-123', fetchImpl as unknown as typeof fetch)
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      headers: { authorization: 'Bearer tok-123' },
    })
  })
})

describe('describeSyncError', () => {
  it('maps each typed failure to a human message that never contains token material', () => {
    const cases = [
      describeSyncError(new SyncPushConflictError(3, 412, '"abc"')),
      describeSyncError(new SyncHttpError('pull', 401)),
      describeSyncError(new SyncHttpError('push', 400)),
      describeSyncError(new SyncHttpError('push', 413)),
      describeSyncError(new SyncHttpError('pull', 500)),
      describeSyncError(new TypeError('fetch failed')),
      describeSyncError(new Error('sync pull returned a malformed payload (missing tables)')),
    ]
    expect(cases[0]).toMatch(/another device/i)
    expect(cases[1]).toMatch(/401/)
    expect(cases[1]).toMatch(/token/i)
    expect(cases[2]).toMatch(/400/)
    expect(cases[3]).toMatch(/413/)
    expect(cases[4]).toMatch(/500/)
    expect(cases[5]).toMatch(/could not reach/i)
    expect(cases[6]).toMatch(/malformed payload/i)
    for (const msg of cases) expect(msg).not.toMatch(/bearer/i)
  })
})
