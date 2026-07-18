/**
 * Track B sync daemon — the personal back-end.
 *
 * A tiny always-on HTTP service (Node built-in `http`, zero framework deps) that
 * holds the canonical brewery state as a `DumpV10` file and exposes exactly what
 * the in-app {@link HttpSyncTransport} client calls, PLUS one write-only route for
 * automatic sensor ingestion:
 *
 *   GET  /state    → 200 + the stored DumpV10 verbatim + an ETag header, or 204 (+
 *                    the well-known empty-sentinel ETag) when none exists yet.
 *   PUT  /state    → optimistic-concurrency write (see below) — validate + persist
 *                    the client's merged DumpV10 as the new canonical.
 *   POST /readings → automatic hydrometer/sensor ingestion (Tilt/iSpindel/RAPT/
 *                    generic — see `reading-ingest.ts`). Token-authed, rate-limited
 *                    per device, runs under the SAME write mutex as PUT /state.
 *                    200 when the device is linked to a batch (see `deviceLinks`)
 *                    and the reading was appended; 202 `{ status: 'unlinked',
 *                    deviceKey }` and NOTHING PERSISTED when it isn't — see that
 *                    module's doc comment for the full design + the Web Bluetooth
 *                    reality check this feature is built around. Docs: `docs/sensors.md`.
 *   GET  /health   → 200 + { ok, daemonVersion, supportedDumpVersions }. UNAUTHENTICATED —
 *                    for uptime monitoring; never touches or leaks brewery data.
 *
 * The /state merge is entirely CLIENT-side (`syncOnce`); the daemon is a dumb
 * store-and-return-the-whole-dump slot for it — NO server-side merge/delta/cursor.
 * /readings is the one place the daemon itself decides what to write (which
 * batch a reading belongs to, via `deviceLinks`) — a deliberately narrow
 * exception: it only ever APPENDS one Zod-validated `Reading` row, never
 * touches any other table, and reuses the same envelope/atomic-write
 * machinery as /state — but NEVER generation rotation (see Integrity: an
 * additive append has nothing destructive to snapshot against).
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
 *   - A per-device Bearer token is MANDATORY on both `/state` methods and on
 *     `POST /readings` (network reachability to your server is defense-in-depth,
 *     not the gate). TWO token scopes exist: FULL tokens (`SYNC_TOKEN_HASHES`)
 *     work on /state AND /readings, unchanged; INGEST-scoped tokens
 *     (`SYNC_INGEST_TOKEN_HASHES`, optional) work ONLY on `POST /readings`, and
 *     presenting one on `/state` gets a 401 indistinguishable on the wire from
 *     a bad token. Sensor bridges are the least-trusted credential holders on
 *     the network (TiltBridge serves its config — token included — on an
 *     unauthenticated LAN page; ESP-class firmware gives its secrets up to a
 *     flash dump), so the token they hold must not be able to GET (full
 *     brewery export) or PUT (destructive overwrite) `/state` — see
 *     `SyncServerOptions.ingestTokenHashes`. `/health` is the sole
 *     unauthenticated route, by design, and returns no brewery data. Tokens
 *     are compared as sha256 hashes with `timingSafeEqual` — plaintext tokens
 *     never live server-side.
 *   - The Authorization header + request body are NEVER logged. A 401 logs one
 *     stderr line: timestamp, SOCKET peer address, path, the token scope the
 *     route requires, and a coarse material-free classification of what was
 *     presented. `X-Forwarded-For` is client-controlled, so it appears only as
 *     a clearly-labeled untrusted extra, never as the primary address — see
 *     `logAuthFailure`.
 *   - Bind to 127.0.0.1 only; a reverse proxy (Caddy/nginx/Traefik) is the sole ingress.
 *
 * Integrity:
 *   - PUT validates the envelope (`parseEnvelope` → Zod every row) AND the ledger
 *     invariant (`amount === Σ deltas`) → 400 on a bad dump, so one buggy device
 *     can't poison canonical.
 *   - Before a PUT overwrites the canonical file, `rotateGenerations` snapshots the
 *     prior version to `<file>.<timestamp>.bak` (see `SYNC_KEEP_GENERATIONS`).
 *     Generations exist to survive DESTRUCTIVE writes, so ONLY `PUT /state`
 *     rotates. An accepted `POST /readings` append deliberately does NOT: a
 *     sensor posting at the 60s rate-limit floor would otherwise flush the
 *     entire `.bak` recovery window in ~10 minutes (keep=10 × 60s), destroying
 *     the documented disaster-recovery path while protecting against nothing —
 *     an append is additive, not destructive.
 *   - Writes go through the atomic temp+rename (`atomicWriteJson`) serialized behind
 *     a mutex, so a concurrent GET never reads a torn file.
 *
 * POST /readings (automatic sensor ingestion):
 *   - Auth + CORS rules follow /state (mandatory Bearer, same opt-in allowlist)
 *     with one deliberate widening: ingest-scoped tokens (see Security above)
 *     are accepted HERE and nowhere else. Body format is auto-detected — JSON,
 *     or `application/x-www-form-urlencoded` (the Tilt app's cloud-URL
 *     convention, `Timepoint=…&Temp=65.0&SG=1.010&Color=PINK`), declared via
 *     Content-Type or sniffed when a non-JSON body parses as a query string
 *     with a known sensor field — see `reading-ingest.ts` for every supported
 *     device shape, the Web Bluetooth reality check, and confidence levels per
 *     adapter. Malformed/unrecognized payload → `400`. The body cap here is a
 *     fixed 256 KB (`INGEST_MAX_BODY_BYTES`) — generous for real sensor
 *     payloads (<2 KB), far below /state's whole-brewery 64 MB allowance;
 *     beyond it → `413`.
 *   - Rate-limited PER DEVICE (`SYNC_INGEST_MIN_INTERVAL_S`, default 60s, `0`
 *     disables) — cheap and in-memory, in TWO phases: a peek BEFORE the write
 *     mutex (a clearly-limited request never touches disk) plus the
 *     authoritative re-check INSIDE the mutex right before the persist. The
 *     peek alone is a TOCTOU hole — N concurrent same-device requests would
 *     all pass it before any of them records a hit. Exceeded → `429
 *     { error: 'rate limited', retryAfterS }`.
 *   - The resolve-device→append→persist sequence runs INSIDE the same write mutex
 *     as PUT /state (same reasoning as the ETag precondition above: two concurrent
 *     ingests, or an ingest racing a PUT, must never interleave against a stale
 *     read of canonical). An unlinked device (no matching `deviceLinks` row)
 *     PERSISTS NOTHING and gets `202 { ok: true, status: 'unlinked', deviceKey }` —
 *     this app has no batch-less-reading view, so an orphan pool would just be
 *     invisible data; the response tells the operator exactly what key to link
 *     instead. A linked device gets `200` + the new `ETag` (NO generation
 *     rotation — see Integrity above) and the appended reading's id.
 *   - The appended `Reading.id` is a content-addressed uuidv5 of
 *     `deviceKey:at:gravity:tempC:ph` (see `ingestReadingId` in
 *     `reading-ingest.ts`) — a device retrying an identical POST (network hiccup,
 *     firmware retry loop) upserts the SAME row instead of creating a duplicate
 *     ONLY when the payload carries its own `at` (today: the generic shape).
 *     The three device-native adapters never parse a payload timestamp, so
 *     their `at` is always this server's `now()` — a retry lands a genuinely
 *     new `at` and mints a new row. For those shapes the per-device rate
 *     limit below is the real retry guard, not this id — see
 *     `reading-ingest.ts`'s `ingestReadingId` doc comment for the full
 *     explanation.
 *   - A link whose `batchId` no longer resolves — the batch was deleted (and
 *     its `deviceLinks` row cascade-tombstoned, see `db/repos/batch.ts`) or
 *     is otherwise absent from the loaded state — PERSISTS NOTHING and gets
 *     `202 { ok: true, status: 'batch-missing', deviceKey }`, checked INSIDE
 *     the same mutex critical section as the write itself (same reasoning as
 *     the ETag precondition: a stale read here could otherwise keep
 *     appending readings to a batch that no longer exists, forever).
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
import {
  createIngestRateLimiter,
  detectAndParseIngest,
  linkAndBuildReading,
} from '@/lib/node/reading-ingest'
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
  /** Path to the canonical brewery.json (DumpV10). */
  filePath: string
  /** sha256-hex hashes of the valid, enabled FULL-scope device tokens — good
   *  on /state AND /readings. Revoke = drop the hash. */
  tokenHashes: ReadonlySet<string>
  /**
   * OPTIONAL ingest-scoped token hashes (env: `SYNC_INGEST_TOKEN_HASHES`) —
   * same sha256-hex format and `timingSafeEqual` compare as `tokenHashes`,
   * but valid ONLY on `POST /readings`. Presenting one on `/state` gets a 401
   * indistinguishable on the wire from a bad token (the server-side audit
   * line DOES distinguish, so a misconfigured bridge stays debuggable — see
   * `classifyPresentedToken`).
   *
   * WHY a second scope: sensor bridges are the least-trusted credential
   * holders on the network. TiltBridge serves its whole config — token
   * included — on an unauthenticated LAN page, and ESP-class firmware gives
   * its stored secrets up to anyone with a USB cable and a flash dump. A
   * bridge holding a FULL token therefore silently holds "read the entire
   * brewery export" (GET /state) and "destructively overwrite it" (PUT
   * /state); an ingest-scoped token caps that blast radius at "append one
   * Zod-validated, rate-limited reading row". Unset → only full tokens exist,
   * bitwise-identical behavior to before this option.
   */
  ingestTokenHashes?: ReadonlySet<string>
  /** Reject a `PUT /state` body larger than this (bytes). Default 64 MB —
   *  /state legitimately carries whole-brewery dumps. `POST /readings` is
   *  capped at the far tighter `min(this, INGEST_MAX_BODY_BYTES)` instead. */
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
  /**
   * Opt-in CORS allowlist (env: `SYNC_ALLOWED_ORIGINS`) — EXACT origins only,
   * e.g. `https://app.example.com`. Needed exactly when the installed PWA is
   * served from a DIFFERENT origin than this daemon (e.g. a hosted demo
   * pointing at a self-hosted daemon); the reference same-origin Caddy deploy
   * never needs it. Unset (default) → not a single CORS header is emitted —
   * bitwise-identical behavior to before this option existed.
   *
   * NO wildcard support, deliberately: this daemon fronts one person's
   * canonical brewery state behind a Bearer token. `*` (or reflecting any
   * Origin) would tell every website's JS "you may read responses from this
   * server", making the browser's origin boundary — the one defense that
   * still holds if a token ever leaks into a page context — a no-op. An
   * exact allowlist keeps the blast radius to origins the operator explicitly
   * trusts. Auth is NEVER relaxed by CORS: a matching origin still 401s
   * without a valid token; the only tokenless CORS path is the OPTIONS
   * preflight, which browsers send without credentials by design and which
   * never touches or returns brewery data.
   */
  allowedOrigins?: ReadonlySet<string>
  /**
   * Injectable clock (env has no equivalent — this is test-only DI, matching
   * `rotateGenerations`' own `now` parameter convention). Used for: a
   * `POST /readings` reading's `at` when the device payload didn't supply
   * one, and the ingest rate limiter's window. Defaults to the wall clock.
   */
  now?: () => Date
  /**
   * Per-device minimum interval (seconds) between ACCEPTED `POST /readings`
   * ingests — a device posting faster gets `429` (env: `SYNC_INGEST_MIN_INTERVAL_S`).
   * Default 60, `0` disables. Cheap, in-memory, per-daemon-process (resets on
   * restart) protection for an internet-exposed write endpoint — see the
   * module doc's "POST /readings" section.
   */
  ingestMinIntervalS?: number
}

const DEFAULT_MAX_BODY = 64 * 1024 * 1024
/** Hard body cap for `POST /readings`, deliberately NOT configurable via env:
 *  real sensor payloads are <2 KB, so 256 KB is generous headroom while
 *  denying an ingest-credential holder (the least-trusted one — see
 *  `SyncServerOptions.ingestTokenHashes`) the ability to lob /state-sized
 *  (64 MB) bodies at this daemon. Applied as `min(maxBodyBytes, this)` so an
 *  operator who tightened the global cap below 256 KB still wins. */
const INGEST_MAX_BODY_BYTES = 256 * 1024
const DEFAULT_INGEST_MIN_INTERVAL_S = 60

/** The token scope a route requires: `/state` needs `full`; `/readings`
 *  accepts `ingest` (which full tokens also satisfy). Audit-log field only. */
type TokenScope = 'full' | 'ingest'

/**
 * Coarse, material-free classification of a rejected credential for the 401
 * audit line: `absent` (no Authorization header at all), `ingest-scoped` (a
 * VALID ingest token presented on a full-scope route — the one misconfig this
 * distinction exists to surface: a sensor bridge pointed at /state), else
 * `invalid`. Server-side log only — the HTTP response NEVER distinguishes
 * these, so a probe against /state can't learn that a stolen ingest token is
 * at least partially valid.
 */
function classifyPresentedToken(
  header: string | undefined,
  ingestTokenHashes: ReadonlySet<string> | undefined,
): 'absent' | 'invalid' | 'ingest-scoped' {
  if (header === undefined) return 'absent'
  if (ingestTokenHashes && verifyBearer(header, ingestTokenHashes)) return 'ingest-scoped'
  return 'invalid'
}

/**
 * One-line 401 audit record — NEVER token material. `remote=` is the SOCKET
 * peer address: `X-Forwarded-For` is a plain client-controlled header (this
 * daemon cannot know which — if any — proxy hops are trustworthy), so
 * honoring its first hop as the primary field would let any client attribute
 * its auth failures to an arbitrary address. When an XFF header is present
 * its raw value is still included, JSON-quoted so it can't smuggle extra
 * `key=value` pairs into the line, under the explicitly-labeled
 * `untrusted-xff=` key — useful context behind the reference Caddy deploy,
 * worthless as evidence.
 */
function logAuthFailure(
  sink: (line: string) => void,
  req: IncomingMessage,
  path: string,
  scope: TokenScope,
  token: 'absent' | 'invalid' | 'ingest-scoped',
): void {
  const at = new Date().toISOString()
  const remote = req.socket.remoteAddress ?? 'unknown'
  const xffHeader = req.headers['x-forwarded-for']
  const xff = Array.isArray(xffHeader) ? xffHeader.join(', ') : xffHeader
  const xffPart = xff ? ` untrusted-xff=${JSON.stringify(xff)}` : ''
  sink(
    `[sync] auth failure at=${at} remote=${remote} path=${path} scope=${scope} token=${token}${xffPart}\n`,
  )
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
  // Parse "Bearer <token>" WITHOUT a backtracking-prone regex. This header is
  // attacker-controlled and reaches here BEFORE auth succeeds, so the split
  // must be linear-time: the old `/^Bearer\s+(.+)$/` let `\s+` and `.+`
  // partition a run of whitespace ambiguously (CodeQL js/polynomial-redos —
  // a header like `Bearer` + many `  ` could drive O(n^2) backtracking).
  // Scheme = text up to the first whitespace; token = the rest, leading
  // whitespace stripped. Behavior-identical to the old regex for every real
  // header (trailing whitespace is already gone via trim()).
  const trimmed = header.trim()
  const firstSpace = trimmed.search(/\s/)
  if (firstSpace === -1) return false
  if (trimmed.slice(0, firstSpace).toLowerCase() !== 'bearer') return false
  const token = trimmed.slice(firstSpace + 1).trimStart()
  if (!token) return false
  const presented = Buffer.from(sha256Hex(token), 'hex')
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
 * Field names that mark a query-string body as a plausible sensor payload:
 * the union of every field the `reading-ingest.ts` adapters actually read,
 * plus the extra fields the Tilt app's cloud-URL convention sends alongside
 * them (`Timepoint`, `Beer`, `Comment`). Used ONLY by the form-encoded sniff
 * in `POST /readings`: `URLSearchParams` "parses" literally any string
 * without erroring, so a body that failed JSON.parse is treated as a form
 * payload only when it yields at least one of these — anything else stays an
 * honest `400 invalid json`.
 */
const INGEST_FORM_FIELDS: ReadonlySet<string> = new Set([
  // generic shape
  'deviceKey',
  'gravity',
  'tempC',
  'ph',
  'at',
  // iSpindel
  'angle',
  'name',
  'ID',
  'temperature',
  'temp_units',
  // Tilt app / Tilt Pi cloud-URL convention
  'Color',
  'SG',
  'Temp',
  'Timepoint',
  'Beer',
  'Comment',
  // Brewfather custom stream
  'temp',
  'temp_unit',
  'gravity_unit',
])

/** Decode an `application/x-www-form-urlencoded` body into a flat
 *  string-valued object (duplicate keys: last one wins). No numeric coercion
 *  here — the ingest adapters accept numeric strings themselves (see
 *  `toFiniteNumber` in reading-ingest.ts), so the raw values route through
 *  the exact same detection pipeline as a JSON body. */
function formBodyToObject(raw: string): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(raw)) obj[key] = value
  return obj
}

/**
 * Build the request handler. Exposed for tests (drive it via a real http.Server on
 * an ephemeral port). Serves `/health` (unauthenticated), `/state`, and
 * `/readings` (automatic sensor ingest); everything else is 404.
 */
export function createSyncHandler(opts: SyncServerOptions) {
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY
  const daemonVersion = opts.daemonVersion ?? DAEMON_VERSION
  const keepGenerations = opts.keepGenerations ?? DEFAULT_KEEP_GENERATIONS
  const authFailureLog = opts.authFailureLog ?? ((line: string) => process.stderr.write(line))
  const ingestTokenHashes = opts.ingestTokenHashes
  // /readings accepts EITHER scope — precomputed union so the request path is
  // one `verifyBearer` walk. /state checks ONLY `opts.tokenHashes`.
  const ingestAcceptedHashes: ReadonlySet<string> =
    ingestTokenHashes && ingestTokenHashes.size > 0
      ? new Set([...opts.tokenHashes, ...ingestTokenHashes])
      : opts.tokenHashes
  const ingestMaxBody = Math.min(maxBody, INGEST_MAX_BODY_BYTES)
  const runExclusive = createMutex()
  const ingestNow = opts.now ?? (() => new Date())
  const ingestRateLimiter = createIngestRateLimiter(
    (opts.ingestMinIntervalS ?? DEFAULT_INGEST_MIN_INTERVAL_S) * 1000,
    ingestNow,
  )

  const allowedOrigins = opts.allowedOrigins

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/'

    // Opt-in CORS (see SyncServerOptions.allowedOrigins). With no allowlist
    // configured this whole block is inert — zero CORS headers, OPTIONS falls
    // through to the pre-existing handling (auth gate → 401 on /state or
    // /readings).
    if (
      allowedOrigins &&
      allowedOrigins.size > 0 &&
      (path === '/state' || path === '/health' || path === '/readings')
    ) {
      const originHeader = req.headers.origin
      const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader
      const matched = origin !== undefined && allowedOrigins.has(origin)
      if (matched) {
        // Echo the ONE matching origin (never *), and tell caches the answer
        // is origin-dependent. ETag must be readable cross-origin — the
        // client's whole optimistic-concurrency loop rides on it.
        res.setHeader('access-control-allow-origin', origin)
        res.setHeader('vary', 'Origin')
        res.setHeader('access-control-expose-headers', 'ETag')
      }
      if (req.method === 'OPTIONS') {
        // Preflight: tokenless 204 by design (browsers strip credentials from
        // preflights, so requiring auth here would break every cross-origin
        // client) — but it NEVER reads state, and a non-matching origin gets
        // no CORS headers at all, so the browser refuses the real request.
        if (matched) {
          const methods = path === '/readings' ? 'POST,OPTIONS' : 'GET,PUT,OPTIONS'
          res.setHeader('access-control-allow-methods', methods)
          res.setHeader('access-control-allow-headers', 'Authorization,Content-Type,If-Match')
          res.setHeader('access-control-max-age', '86400')
        }
        res.writeHead(204)
        res.end()
        return
      }
    }

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

    if (path === '/readings') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      // Auth gates this route too, BEFORE reading any body — same posture as
      // /state, widened by exactly one set: ingest-scoped tokens (see
      // `SyncServerOptions.ingestTokenHashes`) are accepted HERE and nowhere
      // else.
      if (!verifyBearer(req.headers.authorization, ingestAcceptedHashes)) {
        logAuthFailure(
          authFailureLog,
          req,
          path,
          'ingest',
          classifyPresentedToken(req.headers.authorization, undefined),
        )
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }

      let raw: string
      try {
        // The tight ingest cap, NOT /state's 64 MB whole-brewery allowance —
        // see INGEST_MAX_BODY_BYTES.
        raw = await readBody(req, ingestMaxBody)
      } catch {
        sendJson(res, 413, { error: 'body too large' })
        return
      }

      // Body decode: JSON is the primary wire format, but the Tilt app's
      // cloud-URL convention POSTs `application/x-www-form-urlencoded`
      // (`Timepoint=…&Temp=65.0&SG=1.010&Color=PINK`), so that is accepted
      // too: declared via Content-Type, or sniffed when a non-JSON body still
      // parses as a query string carrying at least one known sensor field
      // (some senders mislabel form bodies as text/plain). Either way the
      // result is a flat string-valued object fed to the SAME detection
      // pipeline — the adapters accept numeric strings (reading-ingest.ts).
      const contentTypeHeader = req.headers['content-type']
      const contentType = (
        (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader) ?? ''
      ).toLowerCase()
      let parsedBody: unknown
      if (contentType.includes('application/x-www-form-urlencoded')) {
        parsedBody = formBodyToObject(raw)
      } else {
        try {
          parsedBody = JSON.parse(raw)
        } catch {
          const asForm = formBodyToObject(raw)
          if (!Object.keys(asForm).some((k) => INGEST_FORM_FIELDS.has(k))) {
            sendJson(res, 400, { error: 'invalid json' })
            return
          }
          parsedBody = asForm
        }
      }

      // Auto-detect the device format + normalize the reading (pure — see
      // reading-ingest.ts). A malformed/unrecognized shape 400s here, BEFORE
      // the rate limiter or the write mutex are ever touched.
      const detected = detectAndParseIngest(parsedBody)
      if (!detected.ok) {
        sendJson(res, 400, { error: detected.reason })
        return
      }

      // Cheap, in-memory, per-device PEEK — checked BEFORE the write mutex so
      // a clearly-rate-limited request never touches disk. FAST PATH ONLY: N
      // concurrent same-device requests can all pass this peek before any of
      // them records, so the authoritative re-check lives INSIDE the mutex,
      // right before the persist (below). The peek does NOT record a hit
      // (see `IngestRateLimiter`'s doc in reading-ingest.ts) — the hit is
      // only recorded once a reading has ACTUALLY persisted, so an unlinked/
      // batch-missing/failed outcome never burns the device's slot (F3).
      const precheck = ingestRateLimiter.check(detected.reading.deviceKey)
      if (!precheck.allowed) {
        res.setHeader('retry-after', String(precheck.retryAfterS))
        sendJson(res, 429, { error: 'rate limited', retryAfterS: precheck.retryAfterS })
        return
      }

      type IngestOutcome =
        | { kind: 'unlinked'; deviceKey: string }
        | { kind: 'batch-missing'; deviceKey: string }
        | { kind: 'rate-limited'; retryAfterS: number }
        | {
            kind: 'linked'
            deviceKey: string
            batchId: string
            readingId: string
            warnings: string[]
            etag: string
          }
      let outcome: IngestOutcome
      try {
        outcome = await runExclusive(async () => {
          let rawText: string
          try {
            rawText = await readFile(opts.filePath, 'utf8')
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              // No canonical file at all yet ⇒ there is no deviceLinks table
              // to have EVER matched anything ⇒ always unlinked (same "no
              // table, no links" reasoning as a pre-v10 stored file below).
              return { kind: 'unlinked' as const, deviceKey: detected.reading.deviceKey }
            }
            throw err
          }
          const rawEnvelope = JSON.parse(rawText) as Record<string, unknown>
          // Validated collections are used ONLY to make the link/batch-
          // existence DECISION — the actual write stays surgical (below),
          // never round-tripping the whole dump through this validated
          // (unknown-field-stripping) form. See the module header's
          // "POST /readings" note + reading-ingest.ts.
          const collections = parseEnvelope(rawEnvelope)
          const built = linkAndBuildReading(
            detected.reading,
            collections.deviceLinks,
            collections.readings,
            ingestNow,
          )
          if (built.outcome.status === 'unlinked') {
            return { kind: 'unlinked' as const, deviceKey: built.outcome.deviceKey }
          }
          // F1: a link whose batch no longer exists — deleted (its
          // deviceLinks row is cascade-tombstoned, see db/repos/batch.ts) or
          // otherwise absent/tombstoned in a hand-edited file — must never
          // keep silently accumulating readings forever. Checked HERE,
          // inside the mutex, against the SAME fresh read `built` just used
          // (same reasoning as the ETag precondition: a stale read here
          // could otherwise let a stale link keep writing after its batch
          // is long gone).
          const { batchId } = built.outcome
          const batchExists = collections.batches.some((b) => b.id === batchId)
          const batchTombstoned = collections.rowTombstones.some(
            (t) => t.table === 'batches' && t.id === batchId,
          )
          if (!batchExists || batchTombstoned) {
            return { kind: 'batch-missing' as const, deviceKey: built.outcome.deviceKey }
          }

          // Authoritative rate-limit re-check (the pre-mutex peek is only a
          // fast path): of N concurrent same-device requests, all N pass the
          // peek before any records a hit. Re-checking HERE — inside the
          // mutex, before the persist — is what actually enforces "at most
          // one accepted ingest per device per window"; every loser of the
          // race gets the same 429 the fast path would have given it.
          const recheck = ingestRateLimiter.check(detected.reading.deviceKey)
          if (!recheck.allowed) {
            return { kind: 'rate-limited' as const, retryAfterS: recheck.retryAfterS }
          }

          // SURGICAL write (F4): mutate ONLY `tables.readings`, on the RAW
          // (unvalidated) parsed object — every other table (including any
          // field this app doesn't know about), `meta`, `exportedAt`, and the
          // envelope `version` are carried through EXACTLY as stored. An
          // ingest must never launder the whole dump through Zod's strip-
          // unknown-fields behavior, replace the client's `meta` sidecar, or
          // silently upgrade a v9-stored file to v10 (which would cut off a
          // still-v9 client's restore — see the module header). A v9 file
          // has no `deviceLinks` table, so `collections.deviceLinks` above is
          // always empty for one — every device resolves `unlinked` before
          // this point is ever reached, so a v9 file is never rewritten from
          // here at all.
          const rawTables = ((rawEnvelope.tables as Record<string, unknown>) ?? {}) as Record<
            string,
            unknown
          >
          const rawReadings = Array.isArray(rawTables.readings) ? rawTables.readings : []
          const newReading = built.outcome.reading
          const idx = rawReadings.findIndex(
            (r) =>
              typeof r === 'object' && r !== null && (r as { id?: unknown }).id === newReading.id,
          )
          const nextRawReadings =
            idx < 0
              ? [...rawReadings, newReading]
              : rawReadings.map((r, i) => (i === idx ? newReading : r))
          const nextEnvelope = {
            ...rawEnvelope,
            tables: { ...rawTables, readings: nextRawReadings },
          }

          // Deliberately NO rotateGenerations here — generations exist to
          // survive DESTRUCTIVE writes, and only `PUT /state` rotates. An
          // ingest is an additive append of one row; rotating on every
          // accepted reading would let a sensor at the 60s rate-limit floor
          // flush the entire `.bak` recovery window in ~10 minutes
          // (keep=10 × 60s), destroying the documented disaster-recovery
          // path while protecting against nothing destructive.
          await atomicWriteJson(opts.filePath, nextEnvelope)
          const written = await readFile(opts.filePath, 'utf8')

          // Only NOW — after the persist has actually succeeded — record the
          // rate-limit hit (F3: an outcome that never wrote anything must
          // never burn the device's slot).
          ingestRateLimiter.record(detected.reading.deviceKey)

          return {
            kind: 'linked' as const,
            deviceKey: built.outcome.deviceKey,
            batchId: built.outcome.batchId,
            readingId: newReading.id,
            warnings: built.outcome.warnings,
            etag: etagFor(written),
          }
        })
      } catch {
        sendJson(res, 500, { error: 'write failed' })
        return
      }

      if (outcome.kind === 'unlinked') {
        // Deliberate design (see reading-ingest.ts doc): no orphan pool — the
        // app can't display a batch-less reading, so nothing is persisted;
        // the response tells the operator exactly what key to link.
        sendJson(res, 202, { ok: true, status: 'unlinked', deviceKey: outcome.deviceKey })
        return
      }
      if (outcome.kind === 'batch-missing') {
        // Same persist-nothing treatment as unlinked, distinct status so an
        // operator can tell "never linked" apart from "was linked, but the
        // batch is gone" (F1 — see the module header + db/repos/batch.ts).
        sendJson(res, 202, { ok: true, status: 'batch-missing', deviceKey: outcome.deviceKey })
        return
      }
      if (outcome.kind === 'rate-limited') {
        // Lost the in-mutex re-check to a concurrent same-device ingest that
        // persisted first — same wire contract as the fast-path 429 above.
        res.setHeader('retry-after', String(outcome.retryAfterS))
        sendJson(res, 429, { error: 'rate limited', retryAfterS: outcome.retryAfterS })
        return
      }
      res.setHeader('etag', outcome.etag)
      sendJson(res, 200, {
        ok: true,
        status: 'linked',
        deviceKey: outcome.deviceKey,
        batchId: outcome.batchId,
        readingId: outcome.readingId,
        warnings: outcome.warnings,
      })
      return
    }

    if (path !== '/state') {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    // Auth gates BOTH methods, BEFORE reading any body. FULL tokens only —
    // an ingest-scoped token is rejected here with the same 401 as any bad
    // token (only the server-side audit line tells the operator which).
    if (!verifyBearer(req.headers.authorization, opts.tokenHashes)) {
      logAuthFailure(
        authFailureLog,
        req,
        path,
        'full',
        classifyPresentedToken(req.headers.authorization, ingestTokenHashes),
      )
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
      // reopen the lost-update race. Persist the client's DumpV9 VERBATIM
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
 *   BREWERY_FILE               path to the canonical brewery.json (required)
 *   SYNC_TOKEN_HASHES          comma-separated sha256-hex FULL-scope device-token hashes (required)
 *   SYNC_INGEST_TOKEN_HASHES   optional comma-separated sha256-hex hashes of INGEST-scoped
 *                              tokens — valid ONLY on POST /readings; give these (never a
 *                              full token) to sensor bridges. See
 *                              SyncServerOptions.ingestTokenHashes for the rationale.
 *   SYNC_PORT                  listen port (default 8787)
 *   SYNC_KEEP_GENERATIONS      prior `.bak` generations to retain on PUT (default 10, 0 disables)
 *   SYNC_ALLOWED_ORIGINS       opt-in CORS: comma-separated EXACT origins (no wildcard —
 *                              see SyncServerOptions.allowedOrigins). Unset = no CORS
 *                              headers at all (same-origin deploys need none).
 *   SYNC_INGEST_MIN_INTERVAL_S per-device POST /readings rate limit, seconds
 *                              (default 60, 0 disables — see SyncServerOptions.ingestMinIntervalS)
 * Caddy is the sole ingress; this daemon never binds a public interface.
 */

/** Parse + validate SYNC_ALLOWED_ORIGINS. Exported for tests. Throws on a
 *  wildcard or anything that isn't a bare origin (scheme://host[:port]) — a
 *  misconfigured allowlist should refuse to start, not silently never match. */
export function parseAllowedOrigins(raw: string | undefined): Set<string> | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  const entries = trimmed
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.length > 0)
  if (entries.length === 0) return undefined
  for (const entry of entries) {
    if (entry.includes('*')) {
      throw new Error(
        'SYNC_ALLOWED_ORIGINS must list exact origins — wildcards are not supported (see docs/deploy/README.md)',
      )
    }
    let parsed: URL
    try {
      parsed = new URL(entry)
    } catch {
      throw new Error(`SYNC_ALLOWED_ORIGINS entry is not a valid origin: ${entry}`)
    }
    // A bare origin round-trips through URL.origin unchanged; anything with a
    // path/query/credentials does not (and would never match a browser Origin header).
    if (parsed.origin !== entry) {
      throw new Error(
        `SYNC_ALLOWED_ORIGINS entry must be a bare origin (scheme://host[:port]), got: ${entry}`,
      )
    }
  }
  return new Set(entries)
}

/** Parse + validate SYNC_INGEST_TOKEN_HASHES — same comma-separated
 *  sha256-hex format (and the same per-entry format check) as
 *  SYNC_TOKEN_HASHES. Exported for tests. Unset/empty → undefined (no
 *  ingest scope configured — bitwise-identical daemon behavior to before the
 *  option existed). Set but yielding ZERO valid hashes → throw: that means a
 *  bridge is about to be silently locked out, and a misconfiguration should
 *  refuse to start loudly rather than never match — same philosophy as
 *  `parseAllowedOrigins` above. */
export function parseIngestTokenHashes(raw: string | undefined): Set<string> | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  const hashes = trimmed
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{64}$/.test(s))
  if (hashes.length === 0) {
    throw new Error(
      'SYNC_INGEST_TOKEN_HASHES is set but contains no valid sha256-hex hashes (see docs/deploy/sync.env.example)',
    )
  }
  return new Set(hashes)
}

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
  const ingestTokenHashes = parseIngestTokenHashes(process.env.SYNC_INGEST_TOKEN_HASHES)
  const port = Number(process.env.SYNC_PORT ?? 8787)
  const keepGenerationsRaw = process.env.SYNC_KEEP_GENERATIONS?.trim()
  const keepGenerations =
    keepGenerationsRaw && /^\d+$/.test(keepGenerationsRaw)
      ? Number(keepGenerationsRaw)
      : DEFAULT_KEEP_GENERATIONS
  const ingestMinIntervalRaw = process.env.SYNC_INGEST_MIN_INTERVAL_S?.trim()
  const ingestMinIntervalS =
    ingestMinIntervalRaw && /^\d+$/.test(ingestMinIntervalRaw)
      ? Number(ingestMinIntervalRaw)
      : DEFAULT_INGEST_MIN_INTERVAL_S
  const allowedOrigins = parseAllowedOrigins(process.env.SYNC_ALLOWED_ORIGINS)
  const server = createSyncServer({
    filePath,
    tokenHashes: new Set(hashes),
    keepGenerations,
    ingestMinIntervalS,
    ...(ingestTokenHashes ? { ingestTokenHashes } : {}),
    ...(allowedOrigins ? { allowedOrigins } : {}),
  })
  server.listen(port, '127.0.0.1', () => {
    // Log the bind only — NEVER tokens, auth headers, or bodies.
    console.error(
      `[sync] listening on 127.0.0.1:${port}, file=${filePath}, devices=${hashes.length}, ingest-devices=${ingestTokenHashes?.size ?? 0}, cors-origins=${allowedOrigins?.size ?? 0}, ingest-min-interval-s=${ingestMinIntervalS}`,
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
