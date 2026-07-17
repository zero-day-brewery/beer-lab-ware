/**
 * Sync connection helpers for the in-app UI (Settings card + Diagnostics):
 *
 *   - {@link validateServerUrl} — https:// required (http only for loopback),
 *     with a human "why" for every rejection.
 *   - {@link checkSyncHealth} — `GET /health` (unauthenticated by daemon
 *     design) → daemonVersion + dump-version compatibility vs the app's own
 *     `DUMP_VERSION`.
 *   - {@link probeSyncAuth} — a HEAD-less auth check: `GET /state` but the
 *     response BODY is cancelled immediately after the status is known, so a
 *     status probe never downloads the whole canonical state. (The daemon has
 *     no HEAD route — 405 — and adding one just for a status dot isn't worth
 *     widening the wire surface.)
 *   - {@link describeSyncError} — maps the typed sync errors to human
 *     messages. NEVER includes token material (all messages are static text +
 *     an HTTP status).
 *
 * Browser-safe: no Node imports. `fetchImpl` is injectable for tests.
 */

import { DUMP_VERSION } from '@/lib/db/backup'
import { SyncPushConflictError } from '@/lib/sync/sync-client'
import { SyncHttpError } from '@/lib/sync/transport'

export type UrlValidation = { ok: true; url: string } | { ok: false; reason: string }

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * Validate + normalize a sync server base URL. https:// is REQUIRED — the
 * request carries the device token and the full brewery state, so cleartext
 * transport is only acceptable when it never leaves the machine (localhost /
 * 127.0.0.1 / [::1], the local-daemon dev loop). The normalized form strips
 * trailing slashes (matching `HttpSyncTransport`'s own normalization).
 */
export function validateServerUrl(raw: string): UrlValidation {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, reason: 'Enter your sync server URL.' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'Not a valid URL — expected e.g. https://brewery.example.com.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Use an https:// URL (http:// is allowed only for localhost).' }
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return {
      ok: false,
      reason:
        'https:// required — sync sends your device token and brewery data, so plain ' +
        'http would expose both in transit. http:// is allowed only for localhost/127.0.0.1.',
    }
  }
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason: 'Remove the credentials from the URL — auth is the device token field.',
    }
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, reason: 'Remove the query/fragment — just the server base URL.' }
  }
  // origin + pathname keeps subpath reverse-proxy deploys working; trailing
  // slashes are stripped exactly like HttpSyncTransport does.
  return { ok: true, url: `${url.origin}${url.pathname}`.replace(/\/+$/, '') }
}

export type HealthCheck =
  | {
      ok: true
      daemonVersion: string
      supportedDumpVersions: number[]
      /** Does the daemon accept the envelope version THIS app writes? */
      compatible: boolean
      /** Highest envelope version the daemon accepts (for the mismatch message). */
      maxSupported: number
    }
  | { ok: false; reason: string }

/** The envelope version this app writes — re-exported so UI copy ("this app
 *  writes v9") and the compatibility check can never disagree. */
export const APP_DUMP_VERSION: number = DUMP_VERSION

/** `GET /health` against a (validated) base URL. Unauthenticated by daemon
 *  design — never sends the token. */
export async function checkSyncHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthCheck> {
  let res: Response
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/health`)
  } catch {
    return {
      ok: false,
      reason:
        'Could not reach the server — check the URL and that the daemon is up. If the app ' +
        'is served from a different origin than the daemon, the daemon also needs ' +
        'SYNC_ALLOWED_ORIGINS set (see docs/deploy).',
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: `The server answered ${res.status} on /health — not a healthy sync daemon.`,
    }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return {
      ok: false,
      reason: 'The /health response was not JSON — is this URL really the sync daemon?',
    }
  }
  const b = body as { ok?: unknown; daemonVersion?: unknown; supportedDumpVersions?: unknown }
  if (
    b?.ok !== true ||
    typeof b.daemonVersion !== 'string' ||
    !Array.isArray(b.supportedDumpVersions) ||
    !b.supportedDumpVersions.every((v) => typeof v === 'number')
  ) {
    return {
      ok: false,
      reason: 'Unexpected /health response shape — is this URL really the sync daemon?',
    }
  }
  const supported = b.supportedDumpVersions as number[]
  return {
    ok: true,
    daemonVersion: b.daemonVersion,
    supportedDumpVersions: supported,
    compatible: supported.includes(DUMP_VERSION),
    maxSupported: supported.length > 0 ? Math.max(...supported) : 0,
  }
}

export type AuthProbe = 'ok' | 'unauthorized' | 'error' | 'unreachable'

/**
 * HEAD-less auth probe: `GET /state`, read ONLY the status, cancel the body.
 * 200/204 → the token is accepted; 401 → rejected; anything else → 'error'.
 * The body cancel is what keeps this a cheap status check instead of a full
 * state download (see module doc).
 */
export async function probeSyncAuth(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthProbe> {
  let res: Response
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/state`, {
      headers: { authorization: `Bearer ${token}` },
    })
  } catch {
    return 'unreachable'
  }
  // Never consume the state payload — this is a status probe. cancel() is
  // best-effort (a 204/401 has no meaningful body anyway).
  await res.body?.cancel().catch(() => {})
  if (res.status === 200 || res.status === 204) return 'ok'
  if (res.status === 401) return 'unauthorized'
  return 'error'
}

/**
 * Human message for a failed sync. Static text + HTTP status only — token
 * material can never appear here (and callers additionally scrub, see
 * `SyncSection`).
 */
export function describeSyncError(err: unknown): string {
  if (err instanceof SyncPushConflictError) {
    return (
      'Sync could not finish — another device kept updating the server at the same ' +
      'moment. Nothing was lost locally; wait a few seconds and sync again.'
    )
  }
  if (err instanceof SyncHttpError) {
    if (err.status === 401) {
      return 'The server rejected this device token (401). Check the token, or re-add its hash to SYNC_TOKEN_HASHES on the server.'
    }
    if (err.status === 400) {
      return (
        "The server rejected the data (400) — usually a daemon that doesn't support this " +
        "app's backup format yet. Run Test connection to compare versions, and update the daemon."
      )
    }
    if (err.status === 413) {
      return 'The server refused the payload as too large (413) — raise the daemon body limit.'
    }
    return `Sync failed — the server answered ${err.status}.`
  }
  if (err instanceof TypeError) {
    return (
      'Could not reach the sync server — check the URL and your network. If the app is ' +
      "served from a different origin than the daemon, the daemon's SYNC_ALLOWED_ORIGINS " +
      'must include this app’s origin (see docs/deploy).'
    )
  }
  return `Sync failed: ${err instanceof Error ? err.message : String(err)}`
}
