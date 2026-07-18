/**
 * Track B sync daemon — GET/PUT /state contract, auth, validation, round-trip,
 * plus GET /health, PUT generation rotation, and 401 audit logging.
 *
 * Drives a real http.Server on an ephemeral 127.0.0.1 port with fetch, matching
 * what the in-app HttpSyncTransport does. Confirms: mandatory Bearer auth on both
 * /state methods; ingest-scoped tokens (SYNC_INGEST_TOKEN_HASHES) work ONLY on
 * POST /readings and 401 on /state indistinguishably from a bad token;
 * 204-when-empty / 200-with-verbatim-body round-trip (meta preserved); 400 on
 * bad JSON / bad envelope / ledger violation; 404 off-route; /health is
 * tokenless and never leaks brewery data; PUT snapshots the prior generation to
 * a `.bak` and prunes to SYNC_KEEP_GENERATIONS while an ingest append never
 * rotates; a 401 logs one token-free stderr-style line whose remote= is the
 * socket peer (X-Forwarded-For only as a labeled untrusted extra); the ingest
 * rate limit holds under true same-device concurrency (in-mutex re-check), the
 * write mutex serializes distinct-device ingests, form-encoded Tilt bodies are
 * accepted, and /readings enforces its own 256 KB body cap.
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSyncServer,
  parseAllowedOrigins,
  parseIngestTokenHashes,
  sha256Hex,
  verifyBearer,
} from '@/lib/node/sync-server'
import { EMPTY_ETAG_SENTINEL } from '@/lib/sync/etag'
import { BATCH_ID, fixtureCollections } from '../../fixtures/node/brewery-fixture'

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
    expect(body.supportedDumpVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
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
    expect(lines[0]).toMatch(
      /^\[sync\] auth failure at=\S+ remote=\S+ path=\/state scope=full token=invalid\n$/,
    )
    expect(lines[0]).not.toContain(OTHER)
    expect(lines[0]).not.toContain(TOKEN)
    expect(lines[0]).not.toContain('Bearer')

    lines.length = 0
    const good = await fetch(`${base}/state`, { headers: auth() })
    expect(good.status).toBe(204) // no canonical file yet, but auth succeeded
    expect(lines).toHaveLength(0)

    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('logs the SOCKET peer as remote= and the client-controlled X-Forwarded-For only as a labeled untrusted extra', async () => {
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

    // A client forging XFF must NOT be able to attribute its failure to an
    // arbitrary address: remote= stays the socket peer (this test connects
    // over loopback), and the forged value appears only under the
    // explicitly-labeled untrusted-xff= key, JSON-quoted.
    await fetch(`http://127.0.0.1:${port}/state`, {
      headers: { ...auth(OTHER), 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('remote=127.0.0.1')
    expect(lines[0]).not.toContain('remote=203.0.113.7')
    expect(lines[0]).toContain('untrusted-xff="203.0.113.7, 10.0.0.1"')

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

describe('sync-server — opt-in CORS (SYNC_ALLOWED_ORIGINS)', () => {
  const APP_ORIGIN = 'https://app.example.com'
  const EVIL_ORIGIN = 'https://evil.example.com'
  let server: Server
  let base: string

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function startServer(allowedOrigins?: ReadonlySet<string>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-cors-'))
    server = createSyncServer({
      filePath: join(dir, 'brewery.json'),
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      authFailureLog: () => {},
      ...(allowedOrigins ? { allowedOrigins } : {}),
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  }

  it('DEFAULT (no allowlist): no CORS headers on any response, even with an Origin header', async () => {
    await startServer()
    for (const path of ['/state', '/health']) {
      const res = await fetch(`${base}${path}`, { headers: { ...auth(), origin: APP_ORIGIN } })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
      expect(res.headers.get('access-control-expose-headers')).toBeNull()
      expect(res.headers.get('vary')).toBeNull()
    }
    // Preflight behaves exactly as before the feature existed: OPTIONS /state
    // hits the auth gate (401 tokenless), never a CORS 204.
    const preflight = await fetch(`${base}/state`, {
      method: 'OPTIONS',
      headers: { origin: APP_ORIGIN, 'access-control-request-method': 'PUT' },
    })
    expect(preflight.status).toBe(401)
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('matching Origin: echoed back (never *), Vary: Origin, ETag exposed', async () => {
    await startServer(new Set([APP_ORIGIN]))
    const res = await fetch(`${base}/state`, { headers: { ...auth(), origin: APP_ORIGIN } })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN)
    expect(res.headers.get('vary')).toMatch(/origin/i)
    expect(res.headers.get('access-control-expose-headers')).toMatch(/etag/i)
    expect(res.headers.get('etag')).toBe(EMPTY_ETAG_SENTINEL) // the exposed header is actually there
  })

  it('non-matching Origin: gets NO CORS headers at all (allowlist is exact, no wildcard)', async () => {
    await startServer(new Set([APP_ORIGIN]))
    const res = await fetch(`${base}/state`, { headers: { ...auth(), origin: EVIL_ORIGIN } })
    expect(res.status).toBe(204) // same-origin/no-CORS callers unaffected…
    expect(res.headers.get('access-control-allow-origin')).toBeNull() // …but the browser boundary stays shut
    expect(res.headers.get('access-control-expose-headers')).toBeNull()
  })

  it('preflight (OPTIONS) with a matching Origin: tokenless 204, methods/headers/max-age, never any data', async () => {
    await startServer(new Set([APP_ORIGIN]))
    // First, land real data so a leak would be detectable.
    const put = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: JSON.stringify(validDump()),
    })
    expect(put.status).toBe(200)

    const res = await fetch(`${base}/state`, {
      method: 'OPTIONS',
      headers: { origin: APP_ORIGIN, 'access-control-request-method': 'PUT' }, // NO Authorization
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN)
    expect(res.headers.get('access-control-allow-methods')).toBe('GET,PUT,OPTIONS')
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'Authorization,Content-Type,If-Match',
    )
    expect(Number(res.headers.get('access-control-max-age'))).toBeGreaterThan(0)
    expect(await res.text()).toBe('') // never a body — preflight can't leak state
  })

  it('preflight with a NON-matching Origin: 204 but zero CORS headers (browser blocks it)', async () => {
    await startServer(new Set([APP_ORIGIN]))
    const res = await fetch(`${base}/state`, {
      method: 'OPTIONS',
      headers: { origin: EVIL_ORIGIN, 'access-control-request-method': 'PUT' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-methods')).toBeNull()
    expect(await res.text()).toBe('')
  })

  it('ETag stays exposed on PUT responses too — success AND 412 (the client reads both)', async () => {
    await startServer(new Set([APP_ORIGIN]))
    const okPut = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: { ...authIfMatch(EMPTY_ETAG_SENTINEL), origin: APP_ORIGIN },
      body: JSON.stringify(validDump()),
    })
    expect(okPut.status).toBe(200)
    expect(okPut.headers.get('access-control-expose-headers')).toMatch(/etag/i)
    expect(okPut.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/)

    const stale = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: { ...authIfMatch(EMPTY_ETAG_SENTINEL), origin: APP_ORIGIN },
      body: JSON.stringify(validDump()),
    })
    expect(stale.status).toBe(412)
    expect(stale.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN)
    expect(stale.headers.get('access-control-expose-headers')).toMatch(/etag/i)
  })

  it('401 responses carry CORS headers for a matching origin (the app must be able to READ the 401)', async () => {
    await startServer(new Set([APP_ORIGIN]))
    const res = await fetch(`${base}/state`, { headers: { ...auth(OTHER), origin: APP_ORIGIN } })
    expect(res.status).toBe(401)
    expect(res.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN)
  })

  it('auth is NOT weakened: a matching Origin still 401s without a valid token on GET and PUT', async () => {
    await startServer(new Set([APP_ORIGIN]))
    expect((await fetch(`${base}/state`, { headers: { origin: APP_ORIGIN } })).status).toBe(401)
    expect(
      (
        await fetch(`${base}/state`, {
          method: 'PUT',
          headers: { origin: APP_ORIGIN, 'if-match': EMPTY_ETAG_SENTINEL },
          body: '{}',
        })
      ).status,
    ).toBe(401)
  })
})

describe('parseAllowedOrigins (SYNC_ALLOWED_ORIGINS)', () => {
  it('unset/empty → undefined (CORS fully disabled)', () => {
    expect(parseAllowedOrigins(undefined)).toBeUndefined()
    expect(parseAllowedOrigins('')).toBeUndefined()
    expect(parseAllowedOrigins('  ,  ')).toBeUndefined()
  })

  it('parses a comma-separated list, trimming whitespace and trailing slashes', () => {
    expect(parseAllowedOrigins(' https://app.example.com/ , http://localhost:3030 ')).toEqual(
      new Set(['https://app.example.com', 'http://localhost:3030']),
    )
  })

  it('refuses wildcards and non-origin entries loudly (fail at startup, not silently never-match)', () => {
    expect(() => parseAllowedOrigins('*')).toThrow(/wildcard/i)
    expect(() => parseAllowedOrigins('https://*.example.com')).toThrow(/wildcard/i)
    expect(() => parseAllowedOrigins('not an origin')).toThrow(/not a valid origin/i)
    expect(() => parseAllowedOrigins('https://example.com/path')).toThrow(/bare origin/i)
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

describe('sync-server POST /readings (automatic sensor ingestion)', () => {
  let server: Server
  let base: string
  let filePath: string
  let dir: string

  const LINKED_KEY = 'tilt:RED'

  /** Seed the canonical file directly (bypassing PUT /state) with a v10 dump
   *  whose deviceLinks table links `LINKED_KEY` → the fixture's batch. */
  async function seedLinkedState(): Promise<void> {
    const c = fixtureCollections()
    c.deviceLinks = [
      {
        id: '99999999-0000-4000-8000-000000000abc',
        deviceKey: LINKED_KEY,
        batchId: BATCH_ID,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        schemaVersion: 1,
      },
    ]
    await writeFile(
      filePath,
      JSON.stringify({
        version: 10,
        exportedAt: '2026-07-09T00:00:00.000Z',
        meta: { dumpVersion: 10, dbVersion: 10, rowCounts: {}, schemaVersion: 1 },
        tables: c,
      }),
      'utf8',
    )
  }

  async function startServer(
    opts: Partial<Parameters<typeof createSyncServer>[0]> = {},
  ): Promise<void> {
    server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      authFailureLog: () => {},
      ...opts,
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sync-server-readings-'))
    filePath = join(dir, 'brewery.json')
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function post(body: unknown, t = TOKEN): Promise<Response> {
    return fetch(`${base}/readings`, {
      method: 'POST',
      headers: auth(t),
      body: JSON.stringify(body),
    })
  }

  it('405s a non-POST method', async () => {
    await startServer()
    const res = await fetch(`${base}/readings`, { headers: auth() })
    expect(res.status).toBe(405)
  })

  it('rejects a missing/bad token with 401 and logs one token-free audit line', async () => {
    const lines: string[] = []
    await startServer({ authFailureLog: (line) => lines.push(line) })
    const noAuth = await fetch(`${base}/readings`, {
      method: 'POST',
      body: JSON.stringify({ deviceKey: 'tilt:RED', gravity: 1.04 }),
    })
    expect(noAuth.status).toBe(401)
    const badAuth = await post({ deviceKey: 'tilt:RED', gravity: 1.04 }, 'nope')
    expect(badAuth.status).toBe(401)

    expect(lines).toHaveLength(2)
    // Scope-aware: /readings failures log scope=ingest; the tokenless request
    // classifies as absent, the bad-token one as invalid — never material.
    expect(lines[0]).toMatch(
      /^\[sync\] auth failure at=\S+ remote=\S+ path=\/readings scope=ingest token=absent\n$/,
    )
    expect(lines[1]).toMatch(
      /^\[sync\] auth failure at=\S+ remote=\S+ path=\/readings scope=ingest token=invalid\n$/,
    )
    for (const line of lines) {
      expect(line).not.toContain(TOKEN)
      expect(line).not.toContain('Bearer')
    }
  })

  it('rejects invalid JSON with 400', async () => {
    await startServer()
    const res = await fetch(`${base}/readings`, {
      method: 'POST',
      headers: auth(),
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('rejects an unrecognized payload shape with 400', async () => {
    await startServer()
    const res = await post({ foo: 'bar' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/unrecognized/i)
  })

  it('an UNLINKED device gets 202 {status:"unlinked", deviceKey} and persists NOTHING', async () => {
    await startServer() // no canonical file at all yet
    const res = await post({ deviceKey: 'tilt:GREEN', gravity: 1.042 })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, status: 'unlinked', deviceKey: 'tilt:GREEN' })

    // Nothing was ever written — GET /state still reports empty.
    const state = await fetch(`${base}/state`, { headers: auth() })
    expect(state.status).toBe(204)
  })

  it('a LINKED device (generic shape) gets 200, the reading is appended to the batch, and the ETag changes', async () => {
    await seedLinkedState()
    await startServer()

    const before = await fetch(`${base}/state`, { headers: auth() })
    const etagBefore = before.headers.get('etag')

    const res = await post({ deviceKey: LINKED_KEY, gravity: 1.042, tempC: 19.5 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      status: 'linked',
      deviceKey: LINKED_KEY,
      batchId: BATCH_ID,
    })
    expect(typeof body.readingId).toBe('string')
    expect(res.headers.get('etag')).toBeTruthy()
    expect(res.headers.get('etag')).not.toBe(etagBefore)

    const after = await fetch(`${base}/state`, { headers: auth() })
    const state = await after.json()
    expect(after.headers.get('etag')).toBe(res.headers.get('etag'))
    const appended = state.tables.readings.find((r: { id: string }) => r.id === body.readingId)
    expect(appended).toMatchObject({
      batchId: BATCH_ID,
      gravity: 1.042,
      tempC: 19.5,
      source: 'other',
    })
    // Every other table is untouched — /readings only ever appends a reading.
    expect(state.tables.recipes).toHaveLength(fixtureCollections().recipes.length)
  })

  it('a Tilt-native payload resolves via the SAME link (deviceKey normalization matches)', async () => {
    await seedLinkedState()
    await startServer()
    const res = await post({ Color: 'RED', SG: 1042, Temp: 68 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deviceKey).toBe('tilt:RED')
    expect(body.batchId).toBe(BATCH_ID)
  })

  it('re-posting an IDENTICAL reading dedupes (same reading id, no duplicate row)', async () => {
    await seedLinkedState()
    // Rate limiting is orthogonal to this test's concern (dedupe) — disable it
    // so two rapid posts from the same deviceKey aren't conflated with a 429.
    await startServer({ ingestMinIntervalS: 0 })

    const payload = {
      deviceKey: LINKED_KEY,
      gravity: 1.042,
      tempC: 19.5,
      at: '2026-07-10T12:00:00.000Z',
    }
    const first = await post(payload)
    expect(first.status).toBe(200)
    const firstBody = await first.json()

    const second = await post(payload)
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.readingId).toBe(firstBody.readingId)

    const state = await (await fetch(`${base}/state`, { headers: auth() })).json()
    const matching = state.tables.readings.filter(
      (r: { id: string }) => r.id === firstBody.readingId,
    )
    expect(matching).toHaveLength(1) // upserted, never duplicated
  })

  it('a genuinely different reading from the same device coexists as a second row', async () => {
    await seedLinkedState()
    await startServer({ ingestMinIntervalS: 0 }) // same-device rate limit is not this test's concern
    const first = await post({
      deviceKey: LINKED_KEY,
      gravity: 1.05,
      at: '2026-07-10T00:00:00.000Z',
    })
    const second = await post({
      deviceKey: LINKED_KEY,
      gravity: 1.02,
      at: '2026-07-12T00:00:00.000Z',
    })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(secondBody.readingId).not.toBe(firstBody.readingId)

    const state = await (await fetch(`${base}/state`, { headers: auth() })).json()
    const fixtureReadingCount = fixtureCollections().readings.length
    expect(state.tables.readings).toHaveLength(fixtureReadingCount + 2)
  })

  it('rate-limits a device posting faster than SYNC_INGEST_MIN_INTERVAL_S with 429, never touching the write path', async () => {
    await seedLinkedState()
    const beforeRaw = await readFile(filePath, 'utf8')
    let clock = new Date('2026-07-10T12:00:00.000Z')
    await startServer({ ingestMinIntervalS: 60, now: () => clock })

    const first = await post({ deviceKey: LINKED_KEY, gravity: 1.04 })
    expect(first.status).toBe(200)
    const afterAccepted = await readFile(filePath, 'utf8')
    expect(afterAccepted).not.toBe(beforeRaw) // the ONE accepted write really landed

    clock = new Date(clock.getTime() + 1000) // 1s later — still inside the 60s window
    const second = await post({ deviceKey: LINKED_KEY, gravity: 1.03 })
    expect(second.status).toBe(429)
    const body = await second.json()
    expect(body.error).toMatch(/rate limited/i)
    expect(typeof body.retryAfterS).toBe('number')
    expect(second.headers.get('retry-after')).toBeTruthy()

    // The rate-limited request never reached the write path at all — the
    // state file bytes are IDENTICAL before and after the 429.
    expect(await readFile(filePath, 'utf8')).toBe(afterAccepted)

    // A DIFFERENT device is unaffected by the first device's rate limit.
    clock = new Date(clock.getTime() + 1000)
    const otherDevice = await post({ deviceKey: 'tilt:GREEN', gravity: 1.03 })
    expect(otherDevice.status).toBe(202) // unlinked, but NOT rate-limited
    expect(await readFile(filePath, 'utf8')).toBe(afterAccepted) // …and persisted nothing either

    clock = new Date(clock.getTime() + 60_000)
    const third = await post({ deviceKey: LINKED_KEY, gravity: 1.01 })
    expect(third.status).toBe(200) // window elapsed — accepted again
  })

  it('SYNC_INGEST_MIN_INTERVAL_S = 0 disables rate limiting', async () => {
    await seedLinkedState()
    await startServer({ ingestMinIntervalS: 0 })
    const first = await post({ deviceKey: LINKED_KEY, gravity: 1.04 })
    const second = await post({ deviceKey: LINKED_KEY, gravity: 1.03 })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  it('over-cap body aborts the connection (readBody destroys the socket before a response can be written — pre-existing readBody behavior shared with PUT /state, not new to this route)', async () => {
    await seedLinkedState()
    await startServer({ maxBodyBytes: 10 })
    // `readBody`'s size-cap path calls `req.destroy()` as soon as it sees a
    // chunk over the limit — the request/response share one socket, so the
    // client observes a hard connection reset rather than a clean 413 body.
    // This is the SAME `readBody` helper /state's PUT has always used; this
    // test documents the real observed behavior rather than asserting a
    // status code that never actually reaches the wire.
    await expect(post({ deviceKey: LINKED_KEY, gravity: 1.04 })).rejects.toThrow()
  })

  it('never logs the Authorization header value on a successful ingest', async () => {
    const lines: string[] = []
    await seedLinkedState()
    await startServer({ authFailureLog: (line) => lines.push(line) })
    const res = await post({ deviceKey: LINKED_KEY, gravity: 1.04 })
    expect(res.status).toBe(200)
    expect(lines).toHaveLength(0)
  })

  // ── F1: a link whose batch no longer exists must never keep ingesting ────

  /** Write a v10 dump whose ONE deviceLink points at `batchId`, which is
   *  either genuinely absent from `tables.batches` or present-but-tombstoned
   *  (a defensive, hand-edited-file case) — the caller picks via `tombstone`. */
  async function seedOrphanLinkState(
    deviceKey: string,
    batchId: string,
    opts: { tombstoneBatch?: boolean } = {},
  ): Promise<void> {
    const c = fixtureCollections()
    c.deviceLinks = [
      {
        id: '99999999-1111-4111-8111-000000000abc',
        deviceKey,
        batchId,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        schemaVersion: 1,
      },
    ]
    if (opts.tombstoneBatch) {
      c.rowTombstones = [{ id: batchId, table: 'batches', deletedAt: '2026-07-05T00:00:00.000Z' }]
    }
    await writeFile(
      filePath,
      JSON.stringify({
        version: 10,
        exportedAt: '2026-07-09T00:00:00.000Z',
        meta: { dumpVersion: 10, dbVersion: 10, rowCounts: {}, schemaVersion: 1 },
        tables: c,
      }),
      'utf8',
    )
  }

  it('a link whose batchId is ABSENT from tables.batches gets 202 {status:"batch-missing"} and persists nothing', async () => {
    const missingBatchId = '00000000-0000-4000-8000-0000000000bd'
    await seedOrphanLinkState('tilt:ORPHAN', missingBatchId)
    await startServer()

    const before = await fetch(`${base}/state`, { headers: auth() })
    const etagBefore = before.headers.get('etag')

    const res = await post({ deviceKey: 'tilt:ORPHAN', gravity: 1.04 })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      ok: true,
      status: 'batch-missing',
      deviceKey: 'tilt:ORPHAN',
    })

    const after = await fetch(`${base}/state`, { headers: auth() })
    expect(after.headers.get('etag')).toBe(etagBefore) // nothing written at all
    const state = await after.json()
    expect(state.tables.readings).toHaveLength(fixtureCollections().readings.length)
  })

  it('a link whose batch is present but TOMBSTONED in rowTombstones gets 202 {status:"batch-missing"} and persists nothing', async () => {
    await seedOrphanLinkState('tilt:GONE', BATCH_ID, { tombstoneBatch: true })
    await startServer()

    const res = await post({ deviceKey: 'tilt:GONE', gravity: 1.04 })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, status: 'batch-missing', deviceKey: 'tilt:GONE' })

    const state = await (await fetch(`${base}/state`, { headers: auth() })).json()
    expect(state.tables.readings).toHaveLength(fixtureCollections().readings.length)
  })

  // ── F3: a non-persisting outcome must never burn the rate-limit slot ─────

  it('a batch-missing outcome never records a rate-limit hit — two rapid posts both 202, never 429', async () => {
    const missingBatchId = '00000000-0000-4000-8000-0000000000be'
    await seedOrphanLinkState('tilt:ORPHAN2', missingBatchId)
    await startServer({ ingestMinIntervalS: 60 })

    const first = await post({ deviceKey: 'tilt:ORPHAN2', gravity: 1.04 })
    expect(first.status).toBe(202)
    const second = await post({ deviceKey: 'tilt:ORPHAN2', gravity: 1.03 })
    expect(second.status).toBe(202) // NOT 429
  })

  it('an unlinked outcome never records a rate-limit hit — two rapid posts both 202, never 429', async () => {
    await startServer({ ingestMinIntervalS: 60 }) // no canonical file at all yet
    const first = await post({ deviceKey: 'tilt:NEVER-LINKED', gravity: 1.04 })
    expect(first.status).toBe(202)
    const second = await post({ deviceKey: 'tilt:NEVER-LINKED', gravity: 1.03 })
    expect(second.status).toBe(202) // NOT 429
  })

  // ── F2: honest dedupe — only a payload with its OWN timestamp dedupes ────

  it('re-posting an IDENTICAL device-native (Tilt) reading does NOT dedupe — mints a second row, because no device-native adapter parses a payload timestamp so each POST gets a fresh server `at` (the rate limit, not this id, is the real retry guard for these shapes)', async () => {
    await seedLinkedState()
    let clock = new Date('2026-07-10T12:00:00.000Z')
    await startServer({ ingestMinIntervalS: 0, now: () => clock })

    const payload = { Color: 'RED', SG: 1042, Temp: 68 }
    const first = await post(payload)
    expect(first.status).toBe(200)
    const firstBody = await first.json()

    clock = new Date(clock.getTime() + 1) // "identical" from the device's POV, 1ms later server-side
    const second = await post(payload)
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.readingId).not.toBe(firstBody.readingId)

    const state = await (await fetch(`${base}/state`, { headers: auth() })).json()
    const fixtureReadingCount = fixtureCollections().readings.length
    expect(state.tables.readings).toHaveLength(fixtureReadingCount + 2) // two distinct rows, not one
  })

  // ── F4: the ingest write is SURGICAL — only tables.readings is touched ───

  it('an unknown extra field on a stored row (any other table) survives an ingest byte-for-byte', async () => {
    const c = fixtureCollections()
    c.deviceLinks = [
      {
        id: '99999999-2222-4222-8222-000000000abc',
        deviceKey: LINKED_KEY,
        batchId: BATCH_ID,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        schemaVersion: 1,
      },
    ]
    const tablesWithUnknownField = {
      ...c,
      recipes: [{ ...c.recipes[0], mysteryField: 'keep-me-verbatim' }],
    }
    await writeFile(
      filePath,
      JSON.stringify({
        version: 10,
        exportedAt: '2026-07-09T00:00:00.000Z',
        meta: { dumpVersion: 10, dbVersion: 10, rowCounts: {}, schemaVersion: 1 },
        tables: tablesWithUnknownField,
      }),
      'utf8',
    )
    await startServer()

    const res = await post({ deviceKey: LINKED_KEY, gravity: 1.04 })
    expect(res.status).toBe(200)

    const state = await (await fetch(`${base}/state`, { headers: auth() })).json()
    expect(state.tables.recipes[0].mysteryField).toBe('keep-me-verbatim')
  })

  it('an ingest against a v9-stored file (no deviceLinks table at all) never rewrites the stored envelope to v10 — every device resolves unlinked', async () => {
    const v9Tables: Record<string, unknown> = { ...fixtureCollections() }
    delete v9Tables.deviceLinks
    await writeFile(
      filePath,
      JSON.stringify({
        version: 9,
        exportedAt: '2026-07-09T00:00:00.000Z',
        meta: { dumpVersion: 9, dbVersion: 9, rowCounts: {}, schemaVersion: 1 },
        tables: v9Tables,
      }),
      'utf8',
    )
    await startServer()

    const res = await post({ deviceKey: LINKED_KEY, gravity: 1.04 })
    expect(res.status).toBe(202)
    expect((await res.json()).status).toBe('unlinked') // no deviceLinks table ⇒ nothing can ever match

    const raw = JSON.parse(await readFile(filePath, 'utf8'))
    expect(raw.version).toBe(9) // never silently upgraded by an ingest
  })

  it('a successful ingest preserves `meta`, `version`, and `exportedAt` verbatim — only tables.readings changes', async () => {
    await seedLinkedState()
    await startServer()
    const beforeRaw = JSON.parse(await readFile(filePath, 'utf8'))

    const res = await post({ deviceKey: LINKED_KEY, gravity: 1.04 })
    expect(res.status).toBe(200)

    const afterRaw = JSON.parse(await readFile(filePath, 'utf8'))
    expect(afterRaw.meta).toEqual(beforeRaw.meta)
    expect(afterRaw.version).toBe(beforeRaw.version)
    expect(afterRaw.exportedAt).toBe(beforeRaw.exportedAt)
  })

  // ── rate-limit TOCTOU: the limit must hold under TRUE concurrency ────────

  it('N truly concurrent posts from the SAME device: exactly ONE persists, the rest 429 — the pre-mutex peek alone cannot be bypassed', async () => {
    await seedLinkedState()
    const clock = new Date('2026-07-10T12:00:00.000Z')
    await startServer({ ingestMinIntervalS: 60, now: () => clock })

    // All 8 fire before any response lands, so every one of them passes the
    // cheap pre-mutex peek — only the authoritative re-check INSIDE the
    // mutex can reject the 7 losers of the race.
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        post({ deviceKey: LINKED_KEY, gravity: 1.01 + i * 0.001 }),
      ),
    )
    const statuses = responses.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 429, 429, 429, 429, 429, 429, 429])

    // Every 429 carries the same wire contract as the fast-path one.
    const limited = responses.filter((r) => r.status === 429)
    for (const res of limited) expect(res.headers.get('retry-after')).toBeTruthy()
    const limitedBody = await limited[0].json()
    expect(limitedBody.error).toMatch(/rate limited/i)
    expect(typeof limitedBody.retryAfterS).toBe('number')

    // Exactly ONE reading landed on disk.
    const state = JSON.parse(await readFile(filePath, 'utf8'))
    expect(state.tables.readings).toHaveLength(fixtureCollections().readings.length + 1)
  })

  // ── the write mutex serializes /readings: no lost updates ────────────────

  it('N truly concurrent posts from DISTINCT linked devices ALL persist — the mutex serializes the read-modify-write', async () => {
    const keys = Array.from({ length: 8 }, (_, i) => `sensor:concurrent-${i}`)
    const c = fixtureCollections()
    c.deviceLinks = keys.map((deviceKey, i) => ({
      id: `99999999-3333-4333-8333-00000000000${i}`,
      deviceKey,
      batchId: BATCH_ID,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      schemaVersion: 1,
    }))
    await writeFile(
      filePath,
      JSON.stringify({
        version: 10,
        exportedAt: '2026-07-09T00:00:00.000Z',
        meta: { dumpVersion: 10, dbVersion: 10, rowCounts: {}, schemaVersion: 1 },
        tables: c,
      }),
      'utf8',
    )
    await startServer() // default rate limit — it is per-device, so distinct devices never collide

    const responses = await Promise.all(
      keys.map((deviceKey, i) => post({ deviceKey, gravity: 1.01 + i * 0.001 })),
    )
    for (const res of responses) expect(res.status).toBe(200)
    const bodies = await Promise.all(responses.map((r) => r.json()))
    const readingIds = bodies.map((b) => b.readingId as string)
    expect(new Set(readingIds).size).toBe(keys.length)

    // The state file is ONE valid JSON dump containing EVERY reading — an
    // unserialized read-modify-write would have clobbered at least one
    // concurrent append (a lost update).
    const state = JSON.parse(await readFile(filePath, 'utf8'))
    const persistedIds = state.tables.readings.map((r: { id: string }) => r.id)
    for (const id of readingIds) expect(persistedIds).toContain(id)
    expect(state.tables.readings).toHaveLength(fixtureCollections().readings.length + keys.length)
  })

  // ── ingest appends never rotate generations (disaster-recovery window) ───

  it('an accepted ingest never rotates generations — .bak snapshots belong to destructive PUTs alone', async () => {
    await seedLinkedState()
    await startServer({ ingestMinIntervalS: 0 })

    const bakFiles = async () =>
      (await readdir(dir)).filter((n) => n.startsWith('brewery.json.') && n.endsWith('.bak'))

    // Two accepted appends: were these rotating (the old behavior), a Tilt at
    // the 60s floor would flush the whole keep=10 window in ~10 minutes.
    expect((await post({ deviceKey: LINKED_KEY, gravity: 1.04 })).status).toBe(200)
    expect((await post({ deviceKey: LINKED_KEY, gravity: 1.03 })).status).toBe(200)
    expect(await bakFiles()).toHaveLength(0)

    // The SAME daemon still snapshots on a destructive PUT — generations
    // exist to survive exactly those.
    const etag = (await fetch(`${base}/state`, { headers: auth() })).headers.get('etag') as string
    const put = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(etag),
      body: JSON.stringify(validDump()),
    })
    expect(put.status).toBe(200)
    expect(await bakFiles()).toHaveLength(1)
  })

  // ── form-encoded bodies (the Tilt app cloud-URL convention) ──────────────

  async function postRaw(body: string, headers: Record<string, string>): Promise<Response> {
    return fetch(`${base}/readings`, { method: 'POST', headers, body })
  }

  it('accepts an application/x-www-form-urlencoded body — the Tilt app cloud-URL convention', async () => {
    await seedLinkedState()
    await startServer()
    const res = await postRaw(
      'Timepoint=45123.4269&Temp=65.0&SG=1.010&Color=RED&Comment=&Beer=Untitled',
      { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/x-www-form-urlencoded' },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      status: 'linked',
      deviceKey: 'tilt:RED',
      batchId: BATCH_ID,
    })
    expect(typeof body.readingId).toBe('string')
  })

  it('a form-encoded generic payload routes through the same detection as JSON', async () => {
    await seedLinkedState()
    await startServer()
    const res = await postRaw(`deviceKey=${encodeURIComponent(LINKED_KEY)}&gravity=1.042`, {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/x-www-form-urlencoded',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, status: 'linked', deviceKey: LINKED_KEY })
  })

  it('sniffs a query-string body carrying a known sensor field when the Content-Type is not form-encoded', async () => {
    await seedLinkedState()
    await startServer()
    // No explicit content-type → fetch labels the body text/plain; it is not
    // JSON but IS a query string with known Tilt fields (mislabeling senders
    // exist in the wild).
    const res = await postRaw('Color=RED&SG=1.010&Temp=65.0', {
      authorization: `Bearer ${TOKEN}`,
    })
    expect(res.status).toBe(200)
    expect((await res.json()).deviceKey).toBe('tilt:RED')
  })

  it('still 400s a body that is neither JSON nor a recognizable query string', async () => {
    await startServer()
    // URLSearchParams would happily "parse" this to { 'not json': '' } — the
    // known-field guard is what keeps the response an honest invalid-json 400.
    const res = await postRaw('not json', { authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid json')
  })

  // ── /readings has its own tight body cap, decoupled from /state's 64 MB ──

  it('a /readings body under the 256 KB ingest cap is read + processed normally', async () => {
    await seedLinkedState()
    await startServer()
    const pad = 'x'.repeat(200 * 1024) // ~200 KB — under the ingest cap
    const res = await post({ deviceKey: LINKED_KEY, gravity: 1.04, pad })
    expect(res.status).toBe(200)
  })

  it('POST /readings enforces its own 256 KB cap while /state keeps the 64 MB whole-brewery allowance', async () => {
    await seedLinkedState()
    await startServer() // NO maxBodyBytes override — both routes on their defaults

    // /state happily reads a >256 KB body: the 400 proves it was fully read
    // and JSON-parsed, well past the ingest cap.
    const bigPad = 'x'.repeat(300 * 1024)
    const put = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: authIfMatch(EMPTY_ETAG_SENTINEL),
      body: bigPad,
    })
    expect(put.status).toBe(400)
    expect((await put.json()).error).toBe('invalid json')

    // The SAME body size on /readings trips the ingest cap mid-read (see the
    // over-cap test above for why the client observes a connection abort, not
    // a clean 413).
    await expect(post({ deviceKey: LINKED_KEY, gravity: 1.04, pad: bigPad })).rejects.toThrow()
  })
})

describe('sync-server — ingest-scoped tokens (SYNC_INGEST_TOKEN_HASHES)', () => {
  const INGEST_TOKEN = 'bridge-token-xyz789'
  let server: Server
  let base: string
  let filePath: string

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-ingest-token-'))
    filePath = join(dir, 'brewery.json')
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function startServer(
    opts: Partial<Parameters<typeof createSyncServer>[0]> = {},
  ): Promise<void> {
    server = createSyncServer({
      filePath,
      tokenHashes: new Set([sha256Hex(TOKEN)]),
      ingestTokenHashes: new Set([sha256Hex(INGEST_TOKEN)]),
      authFailureLog: () => {},
      ...opts,
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  }

  async function postReading(t: string): Promise<Response> {
    return fetch(`${base}/readings`, {
      method: 'POST',
      headers: auth(t),
      body: JSON.stringify({ deviceKey: 'tilt:BRIDGE', gravity: 1.042 }),
    })
  }

  it('an ingest-scoped token is accepted on POST /readings', async () => {
    await startServer()
    // 202 unlinked (no canonical file yet) — the point is it got PAST auth
    // all the way to device-link resolution; a rejected token would 401.
    const res = await postReading(INGEST_TOKEN)
    expect(res.status).toBe(202)
    expect((await res.json()).status).toBe('unlinked')
  })

  it('a FULL token still works on POST /readings when ingest tokens are also configured', async () => {
    await startServer()
    const res = await postReading(TOKEN)
    expect(res.status).toBe(202)
  })

  it('an ingest-scoped token on GET and PUT /state gets a 401 indistinguishable from a bad token', async () => {
    await startServer()
    const withIngestGet = await fetch(`${base}/state`, { headers: auth(INGEST_TOKEN) })
    const withGarbageGet = await fetch(`${base}/state`, { headers: auth(OTHER) })
    expect(withIngestGet.status).toBe(401)
    expect(withGarbageGet.status).toBe(401)
    // Identical bodies — a probe can't learn the ingest token is partially valid.
    expect(await withIngestGet.json()).toEqual(await withGarbageGet.json())

    const withIngestPut = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: auth(INGEST_TOKEN),
      body: '{}',
    })
    expect(withIngestPut.status).toBe(401)
  })

  it('the 401 audit line for an ingest token on /state is scope-aware (server-side only, no material)', async () => {
    const lines: string[] = []
    await startServer({ authFailureLog: (line) => lines.push(line) })
    await fetch(`${base}/state`, { headers: auth(INGEST_TOKEN) })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      /^\[sync\] auth failure at=\S+ remote=\S+ path=\/state scope=full token=ingest-scoped\n$/,
    )
    expect(lines[0]).not.toContain(INGEST_TOKEN)
    expect(lines[0]).not.toContain('Bearer')
  })
})

describe('parseIngestTokenHashes (SYNC_INGEST_TOKEN_HASHES)', () => {
  it('unset/empty → undefined (no ingest scope configured)', () => {
    expect(parseIngestTokenHashes(undefined)).toBeUndefined()
    expect(parseIngestTokenHashes('')).toBeUndefined()
    expect(parseIngestTokenHashes('   ')).toBeUndefined()
  })

  it('parses a comma-separated list, trimming and lowercasing (same format as SYNC_TOKEN_HASHES)', () => {
    const a = sha256Hex('bridge-a')
    const b = sha256Hex('bridge-b')
    expect(parseIngestTokenHashes(` ${a.toUpperCase()} , ${b} `)).toEqual(new Set([a, b]))
  })

  it('set but containing no valid sha256-hex hash → throws (refuse to start, never silently lock the bridge out)', () => {
    expect(() => parseIngestTokenHashes('nothex')).toThrow(/sha256-hex/i)
    expect(() => parseIngestTokenHashes('deadbeef')).toThrow(/sha256-hex/i) // right alphabet, wrong length
  })
})

describe('verifyBearer — token parse (linear-time, ReDoS-safe)', () => {
  const tok = 'a'.repeat(64)
  const hashes = new Set([sha256Hex(tok)])

  it('accepts a valid Bearer token (any scheme casing, extra internal whitespace)', () => {
    expect(verifyBearer(`Bearer ${tok}`, hashes)).toBe(true)
    expect(verifyBearer(`bearer ${tok}`, hashes)).toBe(true)
    expect(verifyBearer(`BEARER   ${tok}`, hashes)).toBe(true)
    expect(verifyBearer(`  Bearer ${tok}  `, hashes)).toBe(true) // surrounding ws trimmed
    expect(verifyBearer(`Bearer\t${tok}`, hashes)).toBe(true)
  })

  it('rejects a missing/malformed/wrong-scheme/empty-token header', () => {
    expect(verifyBearer(undefined, hashes)).toBe(false)
    expect(verifyBearer('', hashes)).toBe(false)
    expect(verifyBearer('Bearer', hashes)).toBe(false) // no token
    expect(verifyBearer('Bearer   ', hashes)).toBe(false) // whitespace-only token
    expect(verifyBearer(`Basic ${tok}`, hashes)).toBe(false) // wrong scheme
    expect(verifyBearer(tok, hashes)).toBe(false) // no scheme
    expect(verifyBearer(`Bearer ${'b'.repeat(64)}`, hashes)).toBe(false) // wrong token
  })

  it('does not backtrack on a hostile whitespace-heavy header (completes in well under a second)', () => {
    // The old /^Bearer\s+(.+)$/ could partition a whitespace run ambiguously —
    // O(n^2). This shape is exactly the CodeQL js/polynomial-redos trigger.
    const hostile = `Bearer${' '.repeat(200_000)}`
    const start = performance.now()
    expect(verifyBearer(hostile, hashes)).toBe(false)
    expect(performance.now() - start).toBeLessThan(200)
  })
})
