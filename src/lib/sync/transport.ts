/**
 * Sync transport — how a device push/pulls the canonical brewery state.
 *
 * The payload IS the existing DumpV8 backup envelope (reuse, don't reinvent):
 * the sync service just stores the latest merged dump and hands it back. Two
 * implementations:
 *  - {@link InMemorySyncTransport} — a fake for tests + a local dev double.
 *  - {@link HttpSyncTransport} — talks to your self-hosted sync server (HTTPS),
 *    provisioned separately. Kept a thin typed fetch wrapper so it needs no
 *    server to type-check or unit-test the client around it.
 */

import type { DumpV8 } from '@/lib/db/backup'

/** The wire payload — the DumpV8 backup envelope. */
export type SyncPayload = DumpV8

export interface SyncTransport {
  /** Latest canonical state, or null when the service has none yet. */
  pull(): Promise<SyncPayload | null>
  /** Publish merged state as the new canonical. */
  push(payload: SyncPayload): Promise<void>
}

/** In-memory transport: a single shared slot. Handy as a test double AND as a
 *  local same-tab dev stand-in for the real service. */
export class InMemorySyncTransport implements SyncTransport {
  private slot: SyncPayload | null

  constructor(initial: SyncPayload | null = null) {
    this.slot = initial
  }

  async pull(): Promise<SyncPayload | null> {
    return this.slot
  }

  async push(payload: SyncPayload): Promise<void> {
    this.slot = payload
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

  async pull(): Promise<SyncPayload | null> {
    const res = await this.fetchImpl(`${this.baseUrl}/state`, { headers: this.headers() })
    if (res.status === 204 || res.status === 404) return null
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
    return body as SyncPayload
  }

  async push(payload: SyncPayload): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/state`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`sync push failed: ${res.status}`)
  }
}
