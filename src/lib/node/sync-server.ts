/**
 * Track B sync daemon — the personal back-end.
 *
 * A tiny always-on HTTP service (Node built-in `http`, zero framework deps) that
 * holds the canonical brewery state as a `DumpV8` file and exposes exactly what
 * the in-app {@link HttpSyncTransport} client calls:
 *
 *   GET  /state  → 200 + the stored DumpV8 verbatim, or 204 when none exists yet.
 *   PUT  /state  → validate + persist the client's merged DumpV8 as the new canonical.
 *
 * The merge is entirely CLIENT-side (`syncOnce`); the daemon is a dumb
 * store-and-return-the-whole-dump slot — NO server-side merge/delta/cursor.
 *
 * Security (single-user, multi-device):
 *   - A per-device Bearer token is MANDATORY on BOTH methods (network
 *     reachability to your server is defense-in-depth, not the gate). Tokens
 *     are compared as sha256 hashes with `timingSafeEqual` — plaintext tokens
 *     never live server-side.
 *   - The Authorization header + request body are NEVER logged.
 *   - Bind to 127.0.0.1 only; a reverse proxy (Caddy/nginx/Traefik) is the sole ingress.
 *
 * Integrity:
 *   - PUT validates the envelope (`parseEnvelope` → Zod every row) AND the ledger
 *     invariant (`amount === Σ deltas`) → 400 on a bad dump, so one buggy device
 *     can't poison canonical.
 *   - Writes go through the atomic temp+rename (`atomicWriteJson`) serialized behind
 *     a mutex, so a concurrent GET never reads a torn file.
 *
 * NODE-ONLY: no DOM/Dexie; never imported by pages, so it stays out of the browser bundle.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import { assertLedgerInvariant, atomicWriteJson, parseEnvelope } from '@/lib/node/brewery-store'
import { createMutex } from '@/lib/node/mutex'

/** sha256 hex of a string — used to hash device tokens (never store plaintext). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export interface SyncServerOptions {
  /** Path to the canonical brewery.json (DumpV8). */
  filePath: string
  /** sha256-hex hashes of the valid, enabled device tokens. Revoke = drop the hash. */
  tokenHashes: ReadonlySet<string>
  /** Reject a PUT body larger than this (bytes). Default 64 MB. */
  maxBodyBytes?: number
}

const DEFAULT_MAX_BODY = 64 * 1024 * 1024

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
 * an ephemeral port). Only `/state` is served; everything else is 404.
 */
export function createSyncHandler(opts: SyncServerOptions) {
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY
  const runExclusive = createMutex()

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/'
    if (path !== '/state') {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    // Auth gates BOTH methods, BEFORE reading any body.
    if (!verifyBearer(req.headers.authorization, opts.tokenHashes)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'GET') {
      try {
        const body = await readFile(opts.filePath, 'utf8')
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(body)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          res.writeHead(204).end() // first device — nothing canonical yet
          return
        }
        sendJson(res, 500, { error: 'read failed' })
      }
      return
    }

    if (req.method === 'PUT') {
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
      // Persist the client's DumpV8 VERBATIM (preserve meta/exportedAt/version),
      // atomically, serialized so a concurrent GET never reads a torn file.
      try {
        await runExclusive(() => atomicWriteJson(opts.filePath, parsed))
      } catch {
        sendJson(res, 500, { error: 'write failed' })
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
 *   BREWERY_FILE       path to the canonical brewery.json (required)
 *   SYNC_TOKEN_HASHES  comma-separated sha256-hex device-token hashes (required)
 *   SYNC_PORT          listen port (default 8787)
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
  const server = createSyncServer({ filePath, tokenHashes: new Set(hashes) })
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
