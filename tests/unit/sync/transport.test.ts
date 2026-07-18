/**
 * SyncTransport contract — optimistic-concurrency (ETag / If-Match) surface.
 *
 * `InMemorySyncTransport` is the test double AND local dev stand-in for the real
 * daemon (`sync-server.ts`), so it must enforce the IDENTICAL precondition
 * contract: `pull()` reports `etag: null` exactly when empty, `push()` rejects a
 * stale/absent precondition the same way the server does (412 on mismatch, 428
 * on omission), and a successful push always returns a fresh, changed etag.
 *
 * `HttpSyncTransport` is exercised separately with an injected `fetchImpl` — no
 * real network/server needed — to prove it translates the transport-level
 * `ifMatch: string | null | undefined` contract into the correct wire headers
 * (`If-Match: "empty"` for `null`, the raw value for a string, omitted entirely
 * for `undefined`) and maps the server's status codes back to the same
 * discriminated `SyncPushResult` / `SyncPullResult` shapes.
 */

import { describe, expect, it, vi } from 'vitest'
import { EMPTY_ETAG_SENTINEL } from '@/lib/sync/etag'
import { HttpSyncTransport, InMemorySyncTransport, type SyncPayload } from '@/lib/sync/transport'
import { fixtureEnvelope } from '../../fixtures/node/brewery-fixture'

function payload(over: Partial<SyncPayload> = {}): SyncPayload {
  return { ...fixtureEnvelope(), ...over } as SyncPayload
}

describe('InMemorySyncTransport — mirrors the sync-server ETag/If-Match contract', () => {
  it('pull() reports etag: null and payload: null on a fresh (empty) transport', async () => {
    const t = new InMemorySyncTransport()
    expect(await t.pull()).toEqual({ payload: null, etag: null })
  })

  it('constructing with an initial payload starts with a non-null etag', async () => {
    const t = new InMemorySyncTransport(payload())
    const { payload: p, etag } = await t.pull()
    expect(p).toEqual(payload())
    expect(typeof etag).toBe('string')
    expect(etag).not.toBeNull()
  })

  it('first push into an empty transport is accepted with ifMatch: null, and pull() then reflects it', async () => {
    const t = new InMemorySyncTransport()
    const result = await t.push(payload(), null)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.etag).toBeTruthy()

    const pulled = await t.pull()
    expect(pulled.payload).toEqual(payload())
    expect(pulled.etag).toBe(result.etag)
  })

  it('a successful push returns a NEW etag different from the prior one', async () => {
    const t = new InMemorySyncTransport()
    const first = await t.push(payload(), null)
    if (!first.ok) throw new Error('unreachable')

    const second = await t.push(payload({ exportedAt: '2026-08-01T00:00:00.000Z' }), first.etag)
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('unreachable')
    expect(second.etag).not.toBe(first.etag)

    const pulled = await t.pull()
    expect(pulled.etag).toBe(second.etag)
  })

  it('rejects a stale ifMatch with 412 and surfaces the CURRENT etag', async () => {
    const t = new InMemorySyncTransport()
    const first = await t.push(payload(), null)
    if (!first.ok) throw new Error('unreachable')
    const second = await t.push(payload({ exportedAt: '2026-08-01T00:00:00.000Z' }), first.etag)
    if (!second.ok) throw new Error('unreachable')

    // Reuse the now-stale first.etag.
    const stale = await t.push(payload({ exportedAt: '2026-09-01T00:00:00.000Z' }), first.etag)
    expect(stale).toEqual({ ok: false, status: 412, currentEtag: second.etag })

    // The rejected write never landed.
    const pulled = await t.pull()
    expect(pulled.etag).toBe(second.etag)
  })

  it('rejects a content-shaped ifMatch with 412 when the transport is actually empty', async () => {
    const t = new InMemorySyncTransport()
    const result = await t.push(payload(), '"not-actually-current"')
    expect(result).toEqual({ ok: false, status: 412, currentEtag: null })
  })

  it('rejects ifMatch: null with 412 once the transport is no longer empty', async () => {
    const t = new InMemorySyncTransport()
    const first = await t.push(payload(), null)
    if (!first.ok) throw new Error('unreachable')

    const result = await t.push(payload({ exportedAt: '2026-08-01T00:00:00.000Z' }), null)
    expect(result).toEqual({ ok: false, status: 412, currentEtag: first.etag })
  })

  it('rejects a push with ifMatch entirely omitted with 428, regardless of transport state', async () => {
    const empty = new InMemorySyncTransport()
    expect(await empty.push(payload())).toEqual({ ok: false, status: 428 })

    const seeded = new InMemorySyncTransport(payload())
    expect(await seeded.push(payload({ exportedAt: '2026-08-01T00:00:00.000Z' }))).toEqual({
      ok: false,
      status: 428,
    })
  })
})

describe('HttpSyncTransport — ETag/If-Match header translation (fake fetch, no server)', () => {
  function fakeFetch(handler: (input: string, init?: RequestInit) => Response) {
    return vi.fn(async (input: string | URL, init?: RequestInit) => handler(String(input), init))
  }

  it('pull() maps a 204 (empty) to { payload: null, etag: null }', async () => {
    const fetchImpl = fakeFetch(() => new Response(null, { status: 204 }))
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await t.pull()).toEqual({ payload: null, etag: null })
  })

  it('pull() returns { payload, etag } from a 200 body + ETag header', async () => {
    const dump = payload()
    const fetchImpl = fakeFetch(
      () =>
        new Response(JSON.stringify(dump), {
          status: 200,
          headers: { etag: '"abc123"', 'content-type': 'application/json' },
        }),
    )
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const result = await t.pull()
    expect(result.etag).toBe('"abc123"')
    expect(result.payload).toEqual(dump)
  })

  it('pull() throws when a 200 response carries no ETag header (protocol violation)', async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify(payload()), { status: 200 }))
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(t.pull()).rejects.toThrow(/etag/i)
  })

  it('push() sends `If-Match: "empty"` (the wire sentinel) when ifMatch is null', async () => {
    let seenIfMatch: string | null = null
    const fetchImpl = fakeFetch((_url, init) => {
      seenIfMatch = new Headers(init?.headers).get('if-match')
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { etag: '"new"' } })
    })
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await t.push(payload(), null)
    expect(seenIfMatch).toBe(EMPTY_ETAG_SENTINEL)
  })

  it('push() sends the raw If-Match value when ifMatch is a string', async () => {
    let seenIfMatch: string | null = null
    const fetchImpl = fakeFetch((_url, init) => {
      seenIfMatch = new Headers(init?.headers).get('if-match')
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { etag: '"new"' } })
    })
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await t.push(payload(), '"abc123"')
    expect(seenIfMatch).toBe('"abc123"')
  })

  it('push() omits the If-Match header entirely when ifMatch is not passed', async () => {
    let sawHeader = true
    const fetchImpl = fakeFetch((_url, init) => {
      sawHeader = new Headers(init?.headers).has('if-match')
      return new Response(JSON.stringify({ error: 'precondition-required' }), { status: 428 })
    })
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await t.push(payload())
    expect(sawHeader).toBe(false)
  })

  it('push() returns { ok: true, etag } on 200 with an ETag header', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { etag: '"new-etag"' },
        }),
    )
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await t.push(payload(), null)).toEqual({ ok: true, etag: '"new-etag"' })
  })

  it('push() returns { ok: false, status: 412, currentEtag } on 412', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: 'precondition-failed' }), {
          status: 412,
          headers: { etag: '"current"' },
        }),
    )
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await t.push(payload(), '"stale"')).toEqual({
      ok: false,
      status: 412,
      currentEtag: '"current"',
    })
  })

  it('push() returns { ok: false, status: 428 } on 428', async () => {
    const fetchImpl = fakeFetch(
      () => new Response(JSON.stringify({ error: 'precondition-required' }), { status: 428 }),
    )
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await t.push(payload())).toEqual({ ok: false, status: 428 })
  })

  it('push() throws on an unrelated failure status (e.g. 500)', async () => {
    const fetchImpl = fakeFetch(() => new Response('{}', { status: 500 }))
    const t = new HttpSyncTransport({
      baseUrl: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(t.push(payload(), null)).rejects.toThrow(/500/)
  })
})

describe('HttpSyncTransport — default fetch binding (browser Illegal-invocation regression)', () => {
  // window.fetch is this-sensitive: calling it with `this` set to anything
  // other than undefined/globalThis throws `TypeError: Illegal invocation` in
  // real browsers. Storing the global fetch on an instance property and
  // calling `this.fetchImpl(...)` did exactly that — Node's fetch tolerates
  // it, so only real-browser use failed. This suite installs an equally
  // this-sensitive global fetch to lock the fix (an arrow wrapper) in place.
  it('calls the global fetch unbound (never with the transport as `this`)', async () => {
    const realFetch = globalThis.fetch
    function thisSensitiveFetch(this: unknown): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      }
      return Promise.resolve(new Response(null, { status: 204, headers: { etag: '"empty"' } }))
    }
    globalThis.fetch = thisSensitiveFetch as unknown as typeof fetch
    try {
      const t = new HttpSyncTransport({ baseUrl: 'https://example.test', token: 'tok' })
      await expect(t.pull()).resolves.toEqual({ payload: null, etag: null })
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
