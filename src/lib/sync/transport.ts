/**
 * Sync transport — how a device push/pulls the canonical brewery state.
 *
 * The payload IS the existing DumpV9 backup envelope (reuse, don't reinvent):
 * the sync service just stores the latest merged dump and hands it back. Two
 * implementations:
 *  - {@link InMemorySyncTransport} — a fake for tests + a local dev double.
 *  - {@link HttpSyncTransport} — talks to your self-hosted sync server (HTTPS),
 *    provisioned separately. Kept a thin typed fetch wrapper so it needs no
 *    server to type-check or unit-test the client around it.
 *
 * Optimistic concurrency (ETag / If-Match) — mirrors `sync-server.ts` exactly:
 *  - `pull()` returns `{ payload, etag }`. `etag` is `null` exactly when
 *    `payload` is `null` (nothing canonical yet) — this hides the server's
 *    wire-level empty-sentinel (`EMPTY_ETAG_SENTINEL`) from callers, who only
 *    ever need to know "was there something, and if so what's its current
 *    identity" — see `HttpSyncTransport.pull()` for where that sentinel is
 *    translated at the wire boundary.
 *  - `push(payload, ifMatch)` takes the precondition the caller last observed
 *    (a string etag, or `null` for "I saw it empty"). `ifMatch` is OPTIONAL —
 *    omitting it entirely simulates/represents a caller that sends no
 *    precondition at all (the real HTTP wire equivalent of no `If-Match`
 *    header), which both implementations reject the same way the daemon does:
 *    `{ ok: false, status: 428 }`. Production callers (`syncOnce`) always pass
 *    it explicitly — this is a defensive/test-only path, not a supported
 *    normal usage.
 *  - A rejected push returns a typed `{ ok: false, ... }` result rather than
 *    throwing: unlike a network/server failure (which still throws a plain
 *    `Error`, per this file's existing convention), a stale precondition is an
 *    EXPECTED, recoverable outcome the caller (`syncOnce`'s retry loop) must
 *    branch on programmatically — see `sync-client.ts`.
 */

import type { DumpV9 } from '@/lib/db/backup'
import { EMPTY_ETAG_SENTINEL } from '@/lib/sync/etag'

/** The wire payload — the DumpV9 backup envelope. */
export type SyncPayload = DumpV9

/** Result of `pull()`. `etag` is `null` iff `payload` is `null`. */
export interface SyncPullResult {
  payload: SyncPayload | null
  etag: string | null
}

/** Result of `push()` — a discriminated union so a rejected precondition is a
 *  typed, inspectable outcome rather than a thrown exception (see module doc). */
export type SyncPushResult =
  | { ok: true; etag: string }
  | { ok: false; status: 412; currentEtag: string | null }
  | { ok: false; status: 428 }

export interface SyncTransport {
  /** Latest canonical state + its etag, or both null when the service has none yet. */
  pull(): Promise<SyncPullResult>
  /**
   * Publish merged state as the new canonical, conditioned on `ifMatch` (the
   * etag last observed — `null` for "I saw it empty"). Omitting `ifMatch`
   * simulates a caller sending no precondition at all (see module doc) — real
   * production callers always pass it.
   */
  push(payload: SyncPayload, ifMatch?: string | null): Promise<SyncPushResult>
}

/** In-memory transport: a single shared slot. Handy as a test double AND as a
 *  local same-tab dev stand-in for the real service — enforces the SAME
 *  precondition contract as `sync-server.ts` (412 on mismatch, 428 on a missing
 *  precondition), so code written/tested against it behaves identically once
 *  pointed at the real daemon via `HttpSyncTransport`.
 *
 *  The etag here is an opaque monotonically-incrementing token (`"v1"`, `"v2"`,
 *  …), NOT a sha256 hash — this transport never leaves the process, so it only
 *  needs to enforce identical PRECONDITION SEMANTICS (an opaque identity that
 *  changes exactly when, and only when, the stored content changes), not
 *  byte-for-byte match the wire ETag format. */
export class InMemorySyncTransport implements SyncTransport {
  private slot: SyncPayload | null
  private etag: string | null
  private version = 0

  constructor(initial: SyncPayload | null = null) {
    this.slot = initial
    this.etag = initial ? this.nextEtag() : null
  }

  private nextEtag(): string {
    this.version += 1
    return `"v${this.version}"`
  }

  async pull(): Promise<SyncPullResult> {
    return { payload: this.slot, etag: this.etag }
  }

  async push(payload: SyncPayload, ifMatch?: string | null): Promise<SyncPushResult> {
    if (ifMatch === undefined) return { ok: false, status: 428 }
    if (ifMatch !== this.etag) return { ok: false, status: 412, currentEtag: this.etag }
    this.slot = payload
    this.etag = this.nextEtag()
    return { ok: true, etag: this.etag }
  }
}

export interface HttpSyncTransportOptions {
  /** Base URL of the sync service — your server URL (e.g. https://<your-domain>). */
  baseUrl: string
  /** Optional device token; network reachability to your server is the primary auth. */
  token?: string
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

/** HTTP transport against the self-hosted sync service. `GET /state` returns the
 *  latest dump (204/404 → null); `PUT /state` publishes the merged dump. */
export class HttpSyncTransport implements SyncTransport {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: HttpSyncTransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.token = opts.token
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (this.token) h.authorization = `Bearer ${this.token}`
    return h
  }

  async pull(): Promise<SyncPullResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/state`, { headers: this.headers() })
    // Empty is empty regardless of what wire-level sentinel ETag the daemon put
    // on the 204 (see sync-server.ts) — the transport-level contract is simply
    // etag: null iff payload: null; callers never see the sentinel.
    if (res.status === 204 || res.status === 404) return { payload: null, etag: null }
    if (!res.ok) throw new Error(`sync pull failed: ${res.status}`)
    const body = (await res.json()) as unknown
    // Shape-guard the response so a malformed body fails HERE with a clear error
    // rather than throwing deep inside the merge (mergeDumpTables deref of .tables).
    if (
      !body ||
      typeof body !== 'object' ||
      typeof (body as { tables?: unknown }).tables !== 'object' ||
      (body as { tables?: unknown }).tables === null
    ) {
      throw new Error('sync pull returned a malformed payload (missing tables)')
    }
    const etag = res.headers.get('etag')
    if (!etag) {
      throw new Error('sync pull succeeded (200) but the server returned no ETag header')
    }
    return { payload: body as SyncPayload, etag }
  }

  async push(payload: SyncPayload, ifMatch?: string | null): Promise<SyncPushResult> {
    const headers = this.headers()
    // ifMatch === undefined → no precondition sent at all (see module doc — a
    // defensive/test-only path; production callers always pass it). null →
    // "I saw it empty", translated to the server's wire-level empty sentinel.
    if (ifMatch !== undefined) {
      headers['if-match'] = ifMatch === null ? EMPTY_ETAG_SENTINEL : ifMatch
    }
    const res = await this.fetchImpl(`${this.baseUrl}/state`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    })
    if (res.status === 412) {
      return { ok: false, status: 412, currentEtag: res.headers.get('etag') }
    }
    if (res.status === 428) {
      return { ok: false, status: 428 }
    }
    if (!res.ok) throw new Error(`sync push failed: ${res.status}`)
    const etag = res.headers.get('etag')
    if (!etag) {
      throw new Error('sync push succeeded (200) but the server returned no ETag header')
    }
    return { ok: true, etag }
  }
}
