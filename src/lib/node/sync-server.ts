/**
 * Track B sync daemon — the personal back-end.
 *
 * A tiny always-on HTTP service (Node built-in `http`, zero framework deps) that
 * holds the canonical brewery state as a `DumpV8` file and exposes exactly what
 * the in-app {@link HttpSyncTransport} client calls:
 *
 *   GET  /state   → 200 + the stored DumpV8 verbatim + an ETag header, or 204 (+
 *                   the well-known empty-sentinel ETag) when none exists yet.
 *   PUT  /state   → optimistic-concurrency write (see below) — validate + persist
 *                   the client's merged DumpV8 as the new canonical.
 *   GET  /health  → 200 + { ok, daemonVersion, supportedDumpVersions }. UNAUTHENTICATED —
 *                   for uptime monitoring; never touches or leaks brewery data.
 *
 * The merge is entirely CLIENT-side (`syncOnce`); the daemon is a dumb
 * store-and-return-the-whole-dump slot — NO server-side merge/delta/cursor.
 *
 * Optimistic concurrency (ETag / If-Match):
 *   - `GET /state` returns a STRONG `ETag`: a quoted sha256 hex of the exact
 *     stored JSON bytes. When the store is empty (204), the ETag header is the
 *     well-known sentinel `EMPTY_ETAG_SENTINEL` (`src/lib/sync/etag.ts`) rather
 *     than omitted — this lets `PUT`'s precondition check be ONE uniform
 *     equality comparison (current vs. presented) with no empty-store special
 *     case, and lets a client bootstrap its very first push through the exact
 *     same race-safe path as every subsequent one.
 *   - `PUT /state` REQUIRES `If-Match: <etag>`. No exceptions, no legacy
 *     fallback: there are zero deployed daemons for this protocol version, so
 *     the wire contract is locked down correctly from day one rather than
 *     tolerating an omitted precondition that would only reopen the
 *     lost-update race this feature exists to close. A PUT with no `If-Match`
 *     header is rejected `428 Precondition Required` before the body is even
 *     read. A PUT whose `If-Match` doesn't equal the CURRENT etag (including a
 *     content-shaped etag presented against an empty store, or the empty
 *     sentinel presented against a non-empty store) is rejected
 *     `412 Precondition Failed` (never `409` — 412 is the correct HTTP
 *     semantics for a failed precondition) with `{ error: 'precondition-failed' }`
 *     and the response's `ETag` header set to the CURRENT etag, so a rejected
 *     client can log/inspect what actually won without another GET. On a match,
 *     the write proceeds (existing envelope + ledger-invariant validation
 *     unchanged) and the response carries the NEW `ETag`.
 *   - The precondition compare AND the write happen inside the SAME mutex
 *     critical section used for the write itself (see `runExclusive` below) —
 *     checking "current etag" outside that section would reopen the exact
 *     lost-update race (two PUTs both read the same stale "current" state,
 *     both pass their precondition check, the second silently wins) that this
 *     feature exists to close. Every PUT is therefore fully serialized: of two
 *     concurrent PUTs racing from the same base state, exactly one gets 200 and
 *     the other gets 412 — never both succeeding, never a silent clobber.
 *
 * Security (single-user, multi-device):
 *   - A per-device Bearer token is MANDATORY on both `/state` methods (network
 *     reachability to your server is defense-in-depth, not the gate). `/health`
 *     is the sole unauthenticated route, by design, and returns no brewery data.
 *     Tokens are compared as sha256 hashes with `timingSafeEqual` — plaintext
 *     tokens never live server-side.
 *   - The Authorization header + request body are NEVER logged. A 401 logs one
 *     stderr line (timestamp, remote address, path only — no token material).
 *   - Bind to 127.0.0.1 only; a reverse proxy (Caddy/nginx/Traefik) is the sole ingress.
 *
 * Integrity:
 *   - PUT validates the envelope (`parseEnvelope` → Zod every row) AND the ledger
 *     invariant (`amount === Σ deltas`) → 400 on a bad dump, so one buggy device
 *     can't poison canonical.
 *   - Before a PUT overwrites the canonical file, `rotateGenerations` snapshots the
 *     prior version to `<file>.<timestamp>.bak` (see `SYNC_KEEP_GENERATIONS`).
 *   - Writes go through the atomic temp+rename (`atomicWriteJson`) serialized behind
 *     a mutex, so a concurrent GET never reads a torn file.
 *
 * NODE-ONLY: no DOM/Dexie; never imported by pages, so it stays out of the browser bundle.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import {
  assertLedgerInvariant,
  atomicWriteJson,
  parseEnvelope,
  rotateGenerations,
  SUPPORTED_VERSIONS,
} from '@/lib/node/brewery-store'
import { createMutex } from '@/lib/node/mutex'
import { EMPTY_ETAG_SENTINEL } from '@/lib/sync/etag'
import packageJson from '../../../package.json' with { type: 'json' }

/** The running package's version — the default `GET /health` `daemonVersion`. */
const DAEMON_VERSION: string = packageJson.version

/** Default number of prior generations `PUT /state` retains (see `SYNC_KEEP_GENERATIONS`). */
const DEFAULT_KEEP_GENERATIONS = 10

/** sha256 hex of a string — used to hash device tokens (never store plaintext). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** Strong ETag (RFC 7232 §2.3) for the exact bytes `GET /state` returns / `PUT
 *  /state` just wrote: a quoted sha256 hex of the raw JSON string. Always
 *  strong (never `W/`-prefixed) — the daemon always serves the exact stored
 *  bytes, so a strong validator is correct. */
function etagFor(rawJson: string): string {
  return `"${sha256Hex(rawJson)}"`
}

/** The CURRENT ETag of the canonical file at `filePath`: its strong content
 *  ETag when it exists, or `EMPTY_ETAG_SENTINEL` when nothing has been written
 *  yet. Used by both `GET /state` and `PUT /state`'s If-Match compare, so both
 *  routes agree on exactly what "current state" means. */
async function currentEtagOf(filePath: string): Promise<string> {
  try {
    const body = await readFile(filePath, 'utf8')
    return etagFor(body)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_ETAG_SENTINEL
    throw err
  }
}

export interface SyncServerOptions {
  /** Path to the canonical brewery.json (DumpV8). */
  filePath: string
  /** sha256-hex hashes of the valid, enabled device tokens. Revoke = drop the hash. */
  tokenHashes: ReadonlySet<string>
  /** Reject a PUT body larger than this (bytes). Default 64 MB. */
  maxBodyBytes?: number
  /** `GET /health` `daemonVersion`. Defaults to this package's `version`. */
  daemonVersion?: string
  /** Prior generations `PUT /state` retains via `rotateGenerations`. Default 10, 0 disables. */
  keepGenerations?: number
  /**
   * Sink for the one-line 401 audit log (timestamp, remote address, path —
   * NEVER token material). Defaults to writing to `process.stderr`. Injectable
   * for tests.
   */
  authFailureLog?: (line: string) => void
}

const DEFAULT_MAX_BODY = 64 * 1024 * 1024

/** First `X-Forwarded-For` hop when present (reference deploy is behind Caddy), else the socket peer. */
function remoteAddressOf(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for']
  const first = Array.isArray(xff) ? xff[0] : xff
  if (first) {
    const addr = first.split(',')[0]?.trim()
    if (addr) return addr
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** One-line 401 audit record: timestamp + remote address + path. NEVER token material. */
function logAuthFailure(sink: (line: string) => void, req: IncomingMessage, path: string): void {
  const at = new Date().toISOString()
  sink(`[sync] auth failure at=${at} remote=${remoteAddressOf(req)} path=${path}\n`)
}

/** JSON response with caching disabled; never echoes request auth/body. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(json)
}

/**
 * Constant-time Bearer-token check: sha256 the presented token, then compare
 * against each registered hash with `timingSafeEqual` (equal-length buffers).
 * Returns false for a missing/malformed header or an unknown/revoked token.
 */
export function verifyBearer(
  header: string | undefined,
  tokenHashes: ReadonlySet<string>,
): boolean {
  if (!header) return false
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!m) return false
  const presented = Buffer.from(sha256Hex(m[1]), 'hex')
  let ok = false
  for (const h of tokenHashes) {
    const known = Buffer.from(h, 'hex')
    if (known.length === presented.length && timingSafeEqual(known, presented)) ok = true
  }
  return ok
}

/** Read the full request body with a hard size cap (throws 'body-too-large'). */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxBytes) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Build the request handler. Exposed for tests (drive it via a real http.Server on
 * an ephemeral port). Serves `/health` (unauthenticated) and `/state`; everything
 * else is 404.
 */
export function createSyncHandler(opts: SyncServerOptions) {
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY
  const daemonVersion = opts.daemonVersion ?? DAEMON_VERSION
  const keepGenerations = opts.keepGenerations ?? DEFAULT_KEEP_GENERATIONS
  const authFailureLog = opts.authFailureLog ?? ((line: string) => process.stderr.write(line))
  const runExclusive = createMutex()

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/'

    // Unauthenticated liveness probe — NEVER reads/leaks brewery data, no auth
    // header required. Must stay ahead of the /state auth gate below.
    if (path === '/health') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      sendJson(res, 200, { ok: true, daemonVersion, supportedDumpVersions: SUPPORTED_VERSIONS })
      return
    }

    if (path !== '/state') {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    // Auth gates BOTH methods, BEFORE reading any body.
    if (!verifyBearer(req.headers.authorization, opts.tokenHashes)) {
      logAuthFailure(authFailureLog, req, path)
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'GET') {
      let body: string
      try {
        body = await readFile(opts.filePath, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          // First device — nothing canonical yet. The empty-sentinel ETag lets
          // a client's first PUT go through the same If-Match path as any other.
          res.writeHead(204, { etag: EMPTY_ETAG_SENTINEL, 'cache-control': 'no-store' })
          res.end()
          return
        }
        sendJson(res, 500, { error: 'read failed' })
        return
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        etag: etagFor(body),
      })
      res.end(body)
      return
    }

    if (req.method === 'PUT') {
      // Precondition is mandatory — see the file header's "Optimistic
      // concurrency" note. Checked before even reading the body: a legacy/
      // broken client gets a fast, cheap rejection.
      const ifMatchHeader = req.headers['if-match']
      const ifMatch = (Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader)?.trim()
      if (!ifMatch) {
        sendJson(res, 428, { error: 'precondition-required' })
        return
      }

      let raw: string
      try {
        raw = await readBody(req, maxBody)
      } catch {
        sendJson(res, 413, { error: 'body too large' })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        sendJson(res, 400, { error: 'invalid json' })
        return
      }
      // Validate the envelope + every row + the ledger invariant. A bad dump is
      // rejected here (400) so one buggy device can't poison canonical.
      try {
        const collections = parseEnvelope(parsed)
        assertLedgerInvariant(collections)
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'invalid dump' })
        return
      }
      // The If-Match compare AND the write happen INSIDE the same mutex
      // critical section as each other (and as every other PUT) — see the file
      // header note on why checking the precondition outside this section would
      // reopen the lost-update race. Persist the client's DumpV8 VERBATIM
      // (preserve meta/exportedAt/version), atomically; a concurrent GET never
      // reads a torn file. The prior generation is snapshotted to a `.bak` FIRST
      // (no-op on the very first PUT or when generations are disabled) — this
      // never touches the atomic temp+rename of the main write itself.
      let outcome: { matched: true; etag: string } | { matched: false; etag: string }
      try {
        outcome = await runExclusive(async () => {
          const current = await currentEtagOf(opts.filePath)
          if (ifMatch !== current) {
            return { matched: false as const, etag: current }
          }
          await rotateGenerations(opts.filePath, keepGenerations)
          const json = JSON.stringify(parsed, null, 2)
          await atomicWriteJson(opts.filePath, parsed)
          return { matched: true as const, etag: etagFor(json) }
        })
      } catch {
        sendJson(res, 500, { error: 'write failed' })
        return
      }

      res.setHeader('etag', outcome.etag)
      if (!outcome.matched) {
        sendJson(res, 412, { error: 'precondition-failed' })
        return
      }
      sendJson(res, 200, { ok: true })
      return
    }

    sendJson(res, 405, { error: 'method not allowed' })
  }
}

/** Create (but do not start) the sync HTTP server. */
export function createSyncServer(opts: SyncServerOptions): Server {
  const handle = createSyncHandler(opts)
  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
      else res.end()
    })
  })
}

/**
 * CLI entry — read config from the environment and listen on 127.0.0.1.
 *   BREWERY_FILE           path to the canonical brewery.json (required)
 *   SYNC_TOKEN_HASHES      comma-separated sha256-hex device-token hashes (required)
 *   SYNC_PORT              listen port (default 8787)
 *   SYNC_KEEP_GENERATIONS  prior `.bak` generations to retain on PUT (default 10, 0 disables)
 * Caddy is the sole ingress; this daemon never binds a public interface.
 */
export function startFromEnv(): Server {
  const filePath = process.env.BREWERY_FILE?.trim()
  if (!filePath) throw new Error('BREWERY_FILE is required')
  const hashes = (process.env.SYNC_TOKEN_HASHES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{64}$/.test(s))
  if (hashes.length === 0) {
    throw new Error('SYNC_TOKEN_HASHES must list at least one sha256-hex device-token hash')
  }
  const port = Number(process.env.SYNC_PORT ?? 8787)
  const keepGenerationsRaw = process.env.SYNC_KEEP_GENERATIONS?.trim()
  const keepGenerations =
    keepGenerationsRaw && /^\d+$/.test(keepGenerationsRaw)
      ? Number(keepGenerationsRaw)
      : DEFAULT_KEEP_GENERATIONS
  const server = createSyncServer({ filePath, tokenHashes: new Set(hashes), keepGenerations })
  server.listen(port, '127.0.0.1', () => {
    // Log the bind only — NEVER tokens, auth headers, or bodies.
    console.error(
      `[sync] listening on 127.0.0.1:${port}, file=${filePath}, devices=${hashes.length}`,
    )
  })
  return server
}

// Run only when invoked directly (`tsx src/lib/node/sync-server.ts`), never when
// imported by tests. tsx supplies `import.meta.url` in ESM or CJS.
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    startFromEnv()
  } catch (err) {
    process.stderr.write(`[sync] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}
