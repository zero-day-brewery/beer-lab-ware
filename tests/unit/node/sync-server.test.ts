/**
 * Track B sync daemon — GET/PUT /state contract, auth, validation, round-trip,
 * plus GET /health, PUT generation rotation, and 401 audit logging.
 *
 * Drives a real http.Server on an ephemeral 127.0.0.1 port with fetch, matching
 * what the in-app HttpSyncTransport does. Confirms: mandatory Bearer auth on both
 * /state methods; 204-when-empty / 200-with-verbatim-body round-trip (meta
 * preserved); 400 on bad JSON / bad envelope / ledger violation; 404 off-route;
 * /health is tokenless and never leaks brewery data; PUT snapshots the prior
 * generation to a `.bak` and prunes to SYNC_KEEP_GENERATIONS; a 401 logs one
 * token-free stderr-style line.
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSyncServer, sha256Hex } from '@/lib/node/sync-server'
import { EMPTY_ETAG_SENTINEL } from '@/lib/sync/etag'
import { fixtureCollections } from '../../fixtures/node/brewery-fixture'

const TOKEN = 'device-token-abc123'
const OTHER = 'not-the-token'

function validDump() {
  return {
    version: 8 as const,
    exportedAt: '2026-07-09T00:00:00.000Z',
    meta: { dumpVersion: 8, dbVersion: 8, rowCounts: {}, schemaVersion: 1 as const },
    tables: fixtureCollections(),
  }
}

const auth = (t = TOKEN) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
/** `auth()` plus an `If-Match` precondition header — every PUT needs one now. */
const authIfMatch = (ifMatch: string, t = TOKEN) => ({ ...auth(t), 'if-match': ifMatch })

describe('sync-server /state', () => {
  let server: Server
  let base: string
  let filePath: string

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-'))
    filePath = join(dir, 'brewery.json')
    // These tests exercise 401s incidentally — silence the default stderr sink
    // (item-3 coverage lives in the dedicated "auth-failure logging" suite below).
    server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      authFailureLog: () => {},
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('rejects a missing token with 401 on GET and PUT', async () => {
    expect((await fetch(`${base}/state`)).status).toBe(401)
    const put = await fetch(`${base}/state`, { method: 'PUT', body: '{}' })
    expect(put.status).toBe(401)
  })

  it('rejects a wrong token with 401', async () => {
    expect((await fetch(`${base}/state`, { headers: auth(OTHER) })).status).toBe(401)
  })

  it('returns 204 when no canonical state exists yet', async () => {
    const res = await fetch(`${base}/state`, { headers: auth() })
    expect(res.status).toBe(204)
  })

  it('PUT then GET round-trips the DumpV8 verbatim (meta preserved)', async () => {
    const dump = validDump()
    const put = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify(dump),
    })
    expect(put.status).toBe(200)

    const get = await fetch(`${base}/state`, { headers: auth() })
    expect(get.status).toBe(200)
    const body = await get.json()
    expect(body.version).toBe(8)
    expect(body.meta).toEqual(dump.meta)
    expect(body.tables.recipes).toHaveLength(dump.tables.recipes.length)
  })

  it('rejects invalid JSON with 400', async () => {
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('rejects an unsupported envelope version with 400', async () => {
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify({ version: 99, tables: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a ledger-invariant violation with 400', async () => {
    const dump = validDump()
    dump.tables.inventoryItems[0] = { ...dump.tables.inventoryItems[0], amount: 999 }
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify(dump),
    })
    expect(res.status).toBe(400)
  })

  it('404s any path other than /state', async () => {
    const res = await fetch(`${base}/nope`, { headers: auth() })
    expect(res.status).toBe(404)
  })

  it('405s an unsupported method on /state', async () => {
    const res = await fetch(`${base}/state`, { method: 'DELETE', headers: auth() })
    expect(res.status).toBe(405)
  })
})

describe('sync-server GET /health', () => {
  let server: Server
  let base: string

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-health-'))
    const filePath = join(dir, 'brewery.json')
    server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      authFailureLog: () => {}, // one test below deliberately triggers a 401
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('works with no Authorization header at all', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
  })

  it('/state still 401s tokenless even though /health does not', async () => {
    expect((await fetch(`${base}/state`)).status).toBe(401)
  })

  it('returns exactly { ok, daemonVersion, supportedDumpVersions } and never touches brewery data', async () => {
    const res = await fetch(`${base}/health`)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['daemonVersion', 'ok', 'supportedDumpVersions'])
    expect(body.ok).toBe(true)
    expect(typeof body.daemonVersion).toBe('string')
    expect(body.daemonVersion.length).toBeGreaterThan(0)
    expect(body.supportedDumpVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('honors an injected daemonVersion override', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-health-override-'))
    server = createSyncServer({
      filePath: join(dir, 'brewery.json'),
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      daemonVersion: '9.9.9-test',
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    const body = await res.json()
    expect(body.daemonVersion).toBe('9.9.9-test')
  })

  it('405s a non-GET on /health', async () => {
    const res = await fetch(`${base}/health`, { method: 'PUT', body: '{}' })
    expect(res.status).toBe(405)
  })
})

describe('sync-server PUT /state — generation rotation (SYNC_KEEP_GENERATIONS)', () => {
  let server: Server
  let base: string
  let dir: string
  let filePath: string
  // Threads the precondition across sequential PUTs in this describe block —
  // each call's If-Match must be the etag the PREVIOUS successful PUT returned
  // (or the empty-sentinel for the very first one).
  let currentEtag: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sync-server-gen-'))
    filePath = join(dir, 'brewery.json')
    currentEtag = EMPTY_ETAG_SENTINEL
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function startServer(keepGenerations?: number): Promise<void> {
    server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      ...(keepGenerations === undefined ? {} : { keepGenerations }),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  }

  async function put(exportedAt: string): Promise<void> {
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(currentEtag),
      body: JSON.stringify({ ...validDump(), exportedAt }),
    })
    expect(res.status).toBe(200)
    currentEtag = res.headers.get('etag') as string
    expect(currentEtag).toBeTruthy()
  }

  async function backupFiles(): Promise<string[]> {
    return (await readdir(dir)).filter((n) => n.startsWith('brewery.json.') && n.endsWith('.bak'))
  }

  it('makes no backup on the very first PUT (no prior file to snapshot)', async () => {
    await startServer()
    await put('2026-01-01T00:00:00.000Z')
    expect(await backupFiles()).toHaveLength(0)
  })

  it('snapshots the prior generation to a filename-safe-timestamped .bak on overwrite', async () => {
    await startServer()
    await put('2026-01-01T00:00:00.000Z')
    const priorBody = await readFile(filePath, 'utf8')
    await put('2026-01-02T00:00:00.000Z')

    const backups = await backupFiles()
    expect(backups).toHaveLength(1)
    // <file>.<ISO-timestamp>.bak, e.g. brewery.json.2026-07-16T101500Z.bak (± a
    // collision counter) — never colons/dots from a raw ISO string.
    expect(backups[0]).toMatch(/^brewery\.json\.\d{4}-\d{2}-\d{2}T\d{6}Z(-\d+)?\.bak$/)
    expect(await readFile(join(dir, backups[0]), 'utf8')).toBe(priorBody)

    // The live file reflects the newest PUT, not the backed-up one.
    const live = JSON.parse(await readFile(filePath, 'utf8'))
    expect(live.exportedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('prunes the oldest backups so at most N remain', async () => {
    await startServer(2)
    for (let i = 1; i <= 5; i++) {
      await put(`2026-01-0${i}T00:00:00.000Z`)
    }
    expect(await backupFiles()).toHaveLength(2)
  })

  it('SYNC_KEEP_GENERATIONS=0 disables backups entirely', async () => {
    await startServer(0)
    await put('2026-01-01T00:00:00.000Z')
    await put('2026-01-02T00:00:00.000Z')
    await put('2026-01-03T00:00:00.000Z')
    expect(await backupFiles()).toHaveLength(0)
  })

  it('leaves the main atomic write unaffected — GET always returns one complete, valid dump', async () => {
    await startServer(3)
    for (let i = 1; i <= 4; i++) {
      await put(`2026-02-0${i}T00:00:00.000Z`)
    }
    const res = await fetch(`${base}/state`, { headers: auth() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.exportedAt).toBe('2026-02-04T00:00:00.000Z')
    expect(body.tables.recipes).toHaveLength(fixtureCollections().recipes.length)
  })
})

describe('sync-server /state — 401 auth-failure logging', () => {
  it('logs one token-free line (timestamp, remote address, path) on a bad token, none on success', async () => {
    const lines: string[] = []
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-authlog-'))
    const filePath = join(dir, 'brewery.json')
    const server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      authFailureLog: (line) => lines.push(line),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const base = `http://127.0.0.1:${port}`

    const bad = await fetch(`${base}/state`, { headers: auth(OTHER) })
    expect(bad.status).toBe(401)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[sync\] auth failure at=\S+ remote=\S+ path=\/state\n$/)
    expect(lines[0]).not.toContain(OTHER)
    expect(lines[0]).not.toContain(TOKEN)
    expect(lines[0]).not.toContain('Bearer')

    lines.length = 0
    const good = await fetch(`${base}/state`, { headers: auth() })
    expect(good.status).toBe(204) // no canonical file yet, but auth succeeded
    expect(lines).toHaveLength(0)

    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('prefers the first X-Forwarded-For hop as the logged remote address', async () => {
    const lines: string[] = []
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-authlog-xff-'))
    const filePath = join(dir, 'brewery.json')
    const server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      authFailureLog: (line) => lines.push(line),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    await fetch(`http://127.0.0.1:${port}/state`, {
      headers: { ...auth(OTHER), 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('remote=203.0.113.7')

    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('never logs for /health (unauthenticated by design)', async () => {
    const lines: string[] = []
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-authlog-health-'))
    const filePath = join(dir, 'brewery.json')
    const server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      authFailureLog: (line) => lines.push(line),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
    expect(lines).toHaveLength(0)

    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})

describe('sync-server /state — ETag / If-Match optimistic concurrency', () => {
  let server: Server
  let base: string
  let filePath: string

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-etag-'))
    filePath = join(dir, 'brewery.json')
    server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      authFailureLog: () => {},
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('GET on an empty store returns 204 with the well-known empty-sentinel ETag, no body', async () => {
    const res = await fetch(`${base}/state`, { headers: auth() })
    expect(res.status).toBe(204)
    expect(res.headers.get('etag')).toBe(EMPTY_ETAG_SENTINEL)
    expect(await res.text()).toBe('')
  })

  it('GET after a PUT returns a strong ETag that is exactly sha256(stored bytes), quoted', async () => {
    const put = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify(validDump()),
    })
    expect(put.status).toBe(200)

    const get = await fetch(`${base}/state`, { headers: auth() })
    const bodyText = await get.text()
    // Independently recomputed — not by calling back into the implementation's
    // own helper — to prove the header is genuinely sha256 of the exact bytes.
    const independentEtag = `"${createHash('sha256').update(bodyText, 'utf8').digest('hex')}"`
    expect(get.headers.get('etag')).toBe(independentEtag)
  })

  it('first-ever PUT is accepted with If-Match: <empty-sentinel> and creates the canonical file', async () => {
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify(validDump()),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/)
  })

  it('PUT with the correct current If-Match succeeds and returns a NEW ETag', async () => {
    const first = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify(validDump()),
    })
    const etag1 = first.headers.get('etag') as string
    expect(etag1).toBeTruthy()

    const second = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(etag1),
      body: JSON.stringify({ ...validDump(), exportedAt: '2026-08-01T00:00:00.000Z' }),
    })
    expect(second.status).toBe(200)
    const etag2 = second.headers.get('etag')
    expect(etag2).toBeTruthy()
    expect(etag2).not.toBe(etag1)

    const get = await fetch(`${base}/state`, { headers: auth() })
    expect(get.headers.get('etag')).toBe(etag2)
    expect((await get.json()).exportedAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('PUT with a stale If-Match is rejected 412, surfaces the CURRENT etag, and never touches canonical', async () => {
    const first = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify(validDump()),
    })
    const etag1 = first.headers.get('etag') as string

    const second = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(etag1),
      body: JSON.stringify({ ...validDump(), exportedAt: '2026-08-01T00:00:00.000Z' }),
    })
    const etag2 = second.headers.get('etag') as string

    // Device A reuses the now-stale etag1 — simulates A pushing S1a after B
    // already pushed S1b from the same base (the lost-update repro).
    const stale = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(etag1),
      body: JSON.stringify({ ...validDump(), exportedAt: '2026-09-01T00:00:00.000Z' }),
    })
    expect(stale.status).toBe(412)
    expect(await stale.json()).toEqual({ error: 'precondition-failed' })
    expect(stale.headers.get('etag')).toBe(etag2)

    const get = await fetch(`${base}/state`, { headers: auth() })
    expect((await get.json()).exportedAt).toBe('2026-08-01T00:00:00.000Z') // B's write, never clobbered
  })

  it('PUT with a content-shaped If-Match against an EMPTY store is rejected 412', async () => {
    const fakeContentEtag = `"${'a'.repeat(64)}"`
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(fakeContentEtag),
      body: JSON.stringify(validDump()),
    })
    expect(res.status).toBe(412)
    expect(await res.json()).toEqual({ error: 'precondition-failed' })
    expect(res.headers.get('etag')).toBe(EMPTY_ETAG_SENTINEL)
  })

  it('PUT with no If-Match header at all is rejected 428 against an empty store', async () => {
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify(validDump()),
    })
    expect(res.status).toBe(428)
    expect(await res.json()).toEqual({ error: 'precondition-required' })

    const get = await fetch(`${base}/state`, { headers: auth() })
    expect(get.status).toBe(204) // the 428'd write never landed
  })

  it('PUT with no If-Match header is rejected 428 even against a non-empty store (never overwrites)', async () => {
    const first = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify(validDump()),
    })
    expect(first.status).toBe(200)

    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ ...validDump(), exportedAt: '2026-08-01T00:00:00.000Z' }),
    })
    expect(res.status).toBe(428)

    const get = await fetch(`${base}/state`, { headers: auth() })
    expect((await get.json()).exportedAt).toBe(validDump().exportedAt) // unchanged
  })

  it('two concurrent PUTs from the same base state: exactly one wins (200), the other 412s — the lost-update repro, fixed', async () => {
    const [resA, resB] = await Promise.all([
      fetch(`${base}/state`, {
        method: 'PUT',
        headers: authIfMatch(EMPTY_ETAG_SENTINEL),
        body: JSON.stringify({ ...validDump(), exportedAt: '2026-03-01T00:00:00.000Z' }),
      }),
      fetch(`${base}/state`, {
        method: 'PUT',
        headers: authIfMatch(EMPTY_ETAG_SENTINEL),
        body: JSON.stringify({ ...validDump(), exportedAt: '2026-03-02T00:00:00.000Z' }),
      }),
    ])
    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([200, 412])

    // Canonical reflects exactly the winner — never silently overwritten, never lost.
    const get = await fetch(`${base}/state`, { headers: auth() })
    const body = await get.json()
    expect(['2026-03-01T00:00:00.000Z', '2026-03-02T00:00:00.000Z']).toContain(body.exportedAt)
  })
})
