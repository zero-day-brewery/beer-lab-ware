'use client'
import { useEffect, useState } from 'react'

import {
  APP_DUMP_VERSION,
  type AuthProbe,
  checkSyncHealth,
  type HealthCheck,
  probeSyncAuth,
} from '@/lib/sync/sync-config'
import { type SyncOutcome, syncMetaRepo } from '@/lib/sync/sync-meta'

interface ProbeState {
  health: HealthCheck | null // null while checking
  auth: AuthProbe | null // null while checking / when no token to probe with
}

function fmt(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ')
}

/**
 * Multi-device sync status (Track B): live state, not a placeholder. Reads the
 * device-local connection config (Settings → Sync) and, when configured,
 * probes the daemon: `GET /health` (reachability + dump-version
 * compatibility, unauthenticated by daemon design) and a HEAD-less auth check
 * (`GET /state`, status read, body cancelled — never downloads the state just
 * for a status row; see `probeSyncAuth`). The token itself is never rendered.
 */
export function SyncStatusSection() {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [lastOutcome, setLastOutcome] = useState<SyncOutcome | null>(null)
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [hasToken, setHasToken] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [probes, setProbes] = useState<ProbeState>({ health: null, auth: null })

  useEffect(() => {
    let live = true
    void (async () => {
      const [id, last, outcome, url, token] = await Promise.all([
        syncMetaRepo.deviceId(),
        syncMetaRepo.lastSyncAt(),
        syncMetaRepo.lastOutcome(),
        syncMetaRepo.serverUrl(),
        syncMetaRepo.token(),
      ])
      if (!live) return
      setDeviceId(id)
      setLastSyncAt(last)
      setLastOutcome(outcome)
      setServerUrl(url)
      setHasToken(token !== null)
      setLoaded(true)

      if (url) {
        const [health, auth] = await Promise.all([
          checkSyncHealth(url),
          token ? probeSyncAuth(url, token) : Promise.resolve(null),
        ])
        if (!live) return
        setProbes({ health, auth })
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const configured = serverUrl !== null && hasToken

  const serviceLabel = !loaded
    ? '—'
    : serverUrl === null
      ? 'not configured — add a server in Settings → Sync'
      : hasToken
        ? serverUrl
        : `${serverUrl} (no device token yet)`

  const reachLabel = !serverUrl
    ? '—'
    : probes.health === null
      ? 'checking…'
      : probes.health.ok
        ? `reachable (daemon v${probes.health.daemonVersion})`
        : `unreachable — ${probes.health.reason}`

  const compatLabel = !serverUrl
    ? '—'
    : probes.health === null
      ? 'checking…'
      : !probes.health.ok
        ? '—'
        : probes.health.compatible
          ? `compatible (app writes dump v${APP_DUMP_VERSION})`
          : `server accepts up to v${probes.health.maxSupported}, this app writes v${APP_DUMP_VERSION} — update the server`

  const authLabel = !configured
    ? '—'
    : probes.auth === null
      ? 'checking…'
      : probes.auth === 'ok'
        ? 'token accepted'
        : probes.auth === 'unauthorized'
          ? 'token REJECTED (401) — re-check it in Settings → Sync'
          : probes.auth === 'unreachable'
            ? 'unreachable'
            : 'unexpected server response'

  const outcomeLabel = lastOutcome
    ? `${lastOutcome.ok ? '✓' : '✕'} ${fmt(lastOutcome.at)} (${lastOutcome.mode}) — ${lastOutcome.message}`
    : 'no sync attempted yet'

  return (
    <section className="tap-card flex flex-col gap-3 p-5" data-testid="diag-sync">
      <h2 className="text-lg font-semibold">Multi-device sync</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Device ID</dt>
        <dd className="font-mono text-xs" data-testid="diag-sync-device">
          {deviceId ? `${deviceId.slice(0, 8)}…` : '—'}
        </dd>
        <dt className="text-muted-foreground">Service</dt>
        <dd className="break-all" data-testid="diag-sync-service">
          {serviceLabel}
        </dd>
        <dt className="text-muted-foreground">Reachability</dt>
        <dd data-testid="diag-sync-reach">{reachLabel}</dd>
        <dt className="text-muted-foreground">Dump version</dt>
        <dd data-testid="diag-sync-compat">{compatLabel}</dd>
        <dt className="text-muted-foreground">Auth</dt>
        <dd data-testid="diag-sync-auth">{authLabel}</dd>
        <dt className="text-muted-foreground">Last sync</dt>
        <dd data-testid="diag-sync-last">{lastSyncAt ? fmt(lastSyncAt) : 'never'}</dd>
        <dt className="text-muted-foreground">Last outcome</dt>
        <dd data-testid="diag-sync-outcome">{outcomeLabel}</dd>
      </dl>
    </section>
  )
}
