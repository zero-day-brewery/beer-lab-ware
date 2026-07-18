'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { backupService } from '@/lib/db/backup'
import { runBackup } from '@/lib/storage/backup-run'
import { type SyncMode, type SyncResult, syncOnce } from '@/lib/sync/sync-client'
import {
  APP_DUMP_VERSION,
  checkSyncHealth,
  describeSyncError,
  validateServerUrl,
} from '@/lib/sync/sync-config'
import { syncMetaRepo } from '@/lib/sync/sync-meta'
import { HttpSyncTransport } from '@/lib/sync/transport'

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }

const MODE_OPTIONS: { value: SyncMode; label: string; hint: string }[] = [
  {
    value: 'two-way',
    label: 'Two-way (recommended)',
    hint: 'Pull, merge, and publish — safe with deletes and concurrent edits on every device.',
  },
  {
    value: 'pull-only',
    label: 'Pull only',
    hint: 'This device follows the server ("phone follows") — it merges canonical down but never publishes local changes.',
  },
  {
    value: 'push-only',
    label: 'Push only',
    hint: 'This device is canonical ("desktop is canonical") — it publishes its state and never pulls others’ changes down.',
  },
]

function summarizeResult(result: SyncResult, mode: SyncMode): string {
  const did = [
    result.pulled ? 'pulled' : null,
    result.merged ? 'merged' : null,
    result.pushed ? 'pushed' : null,
  ].filter((s): s is string => s !== null)
  const rows = Object.values(result.counts).reduce((a, b) => a + b, 0)
  const doneWhat = did.length > 0 ? did.join(' + ') : 'nothing to do'
  return `Sync complete (${mode}) — ${doneWhat} · ${rows} rows`
}

/**
 * Multi-device sync connection (Track B). Server URL + per-device token live in
 * the DEVICE-LOCAL appMeta store (`syncMetaRepo`) — never in a Dexie table
 * that enters dumps, so they can't leak into a backup file or the sync payload
 * itself (frozen by tests/unit/node/sync-secret-exclusion.test.ts).
 */
export function SyncSection() {
  const [loaded, setLoaded] = useState(false)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [mode, setMode] = useState<SyncMode>('two-way')
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const [storedUrl, storedToken, storedMode] = await Promise.all([
        syncMetaRepo.serverUrl(),
        syncMetaRepo.token(),
        syncMetaRepo.mode(),
      ])
      if (!live) return
      setUrl(storedUrl ?? '')
      setToken(storedToken ?? '')
      setMode(storedMode)
      setLoaded(true)
    })()
    return () => {
      live = false
    }
  }, [])

  const validation = validateServerUrl(url)
  const showUrlError = url.trim() !== '' && !validation.ok
  const configured = validation.ok && token.trim() !== ''

  const onUrlChange = (value: string) => {
    setTest({ kind: 'idle' })
    setUrl(value)
    const v = validateServerUrl(value)
    // Persist only a valid (normalized) URL — or clear when emptied. An
    // half-typed URL never overwrites the last known-good one.
    if (v.ok) void syncMetaRepo.setServerUrl(v.url).catch(() => {})
    else if (value.trim() === '') void syncMetaRepo.setServerUrl('').catch(() => {})
  }

  const onTokenChange = (value: string) => {
    setTest({ kind: 'idle' })
    setToken(value)
    void syncMetaRepo.setToken(value).catch(() => {})
  }

  const onModeChange = (value: SyncMode) => {
    setMode(value)
    void syncMetaRepo.setMode(value).catch(() => {})
  }

  const onTest = async () => {
    if (!validation.ok) return
    setTest({ kind: 'testing' })
    const health = await checkSyncHealth(validation.url)
    if (!health.ok) {
      setTest({ kind: 'error', message: health.reason })
      return
    }
    if (!health.compatible) {
      setTest({
        kind: 'error',
        message:
          `Server reachable (daemon v${health.daemonVersion}) but it accepts up to ` +
          `dump v${health.maxSupported}, and this app writes v${APP_DUMP_VERSION} — update the server.`,
      })
      return
    }
    setTest({
      kind: 'ok',
      message: `Connected — daemon v${health.daemonVersion}, accepts dump v${APP_DUMP_VERSION}.`,
    })
  }

  const onSyncNow = async () => {
    if (!validation.ok || token.trim() === '') return
    setSyncing(true)
    const startedAt = new Date().toISOString()
    const plainToken = token.trim()
    try {
      const transport = new HttpSyncTransport({ baseUrl: validation.url, token: plainToken })
      const result = await syncOnce({
        transport,
        backup: backupService,
        snapshot: runBackup, // the production pre-restore safety snapshot
        now: startedAt,
        mode,
      })
      const message = summarizeResult(result, mode)
      await syncMetaRepo.setLastSyncAt(result.lastSyncAt)
      await syncMetaRepo.setLastOutcome({ at: startedAt, mode, ok: true, message })
      toast.success(message)
    } catch (err) {
      // describeSyncError never includes token material by construction; the
      // scrub below is defense-in-depth against any future error path.
      const message = describeSyncError(err).split(plainToken).join('[token]')
      await syncMetaRepo.setLastOutcome({ at: startedAt, mode, ok: false, message }).catch(() => {})
      toast.error(message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="tap-card flex flex-col gap-4 p-5" data-testid="sync-section">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">🔁 Multi-device</span>
        <h2 className="text-lg font-semibold">Sync</h2>
        <p className="text-sm text-muted-foreground">
          Point this device at your self-hosted sync daemon (see docs/deploy in the repo). Your
          brewery state stays on hardware you control.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Server URL</span>
        <input
          type="text"
          aria-label="Sync server URL"
          inputMode="url"
          autoComplete="off"
          placeholder="https://brewery.example.com"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          disabled={!loaded}
          className="field"
        />
      </label>
      {showUrlError && !validation.ok && (
        <p className="text-sm text-destructive" data-testid="sync-url-error">
          {validation.reason}
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Device token</span>
        <input
          type="password"
          aria-label="Device token"
          autoComplete="off"
          placeholder="the per-device token you generated on the server"
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          disabled={!loaded}
          className="field"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onTest}
          disabled={!validation.ok || test.kind === 'testing' || syncing}
          className="btn-ghost disabled:opacity-50"
        >
          {test.kind === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          onClick={onSyncNow}
          disabled={!configured || syncing || test.kind === 'testing'}
          className="btn-primary disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {test.kind === 'ok' && (
        <p className="text-sm text-primary" data-testid="sync-test-ok">
          ✓ {test.message}
        </p>
      )}
      {test.kind === 'error' && (
        <p className="text-sm text-destructive" data-testid="sync-test-error">
          ✕ {test.message}
        </p>
      )}

      <details className="rounded-md border border-border/70 bg-card/40 p-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced — sync direction</summary>
        <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="Sync direction">
          {MODE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="sync-mode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => onModeChange(opt.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </details>

      <p className="rounded-md border border-border/70 bg-card/40 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Privacy.</strong> The server URL and device token are
        stored only on this device — they are never written into backups and never included in the
        synced data itself. Sync sends your brewery state only to the server you configure here.
      </p>
    </section>
  )
}
