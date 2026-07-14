'use client'
import { useEffect, useState } from 'react'
import { IntegritySection } from '@/components/diagnostics/integrity-section'
import { SyncStatusSection } from '@/components/diagnostics/sync-status-section'
import { BackupSettingsCard } from '@/components/durability/backup-settings-card'
import { DurabilityBadge } from '@/components/durability/durability-badge'
import { CopyDiagnosticsButton } from '@/components/shell/copy-diagnostics-button'
import { collectDiagnostics, type DiagnosticsSnapshot } from '@/lib/diagnostics/collect-diagnostics'
import { reportDbError } from '@/lib/diagnostics/error-log'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(1)} ${units[i]}`
}

function swLabel(sw: DiagnosticsSnapshot['sw']): string {
  if (!sw.supported) return 'unsupported'
  return sw.registered ? 'registered' : 'supported (not registered)'
}

export function DiagnosticsView() {
  const [snap, setSnap] = useState<DiagnosticsSnapshot | null>(null)

  useEffect(() => {
    collectDiagnostics()
      .then(setSnap)
      .catch((e) => reportDbError('diagnostics', e))
  }, [])

  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="diagnostics-view">
      <header className="border-b border-border/70 pb-6">
        <span className="eyebrow">🩺 Health</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Diagnostics</h1>
      </header>

      {snap === null ? (
        <p className="text-sm text-muted-foreground" data-testid="diagnostics-loading">
          Gathering diagnostics…
        </p>
      ) : (
        <>
          {/* Storage & durability — reuses the E1 badge + quota bar */}
          <section className="tap-card flex flex-col gap-3 p-5" data-testid="diag-storage">
            <h2 className="text-lg font-semibold">Storage &amp; durability</h2>
            <DurabilityBadge />
            {snap.storage.estimate ? (
              <div className="flex flex-col gap-1">
                <div className="quota-bar h-2 w-full rounded bg-border/50">
                  <div
                    className="h-full rounded bg-primary"
                    style={{
                      width: `${Math.min(100, Math.round(snap.storage.estimate.percentUsed * 100))}%`,
                    }}
                    data-testid="diag-quota-bar"
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(snap.storage.estimate.usageBytes)} /{' '}
                  {formatBytes(snap.storage.estimate.quotaBytes)} used
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Storage estimate unavailable</p>
            )}
          </section>

          {/* Backup — echoes the E1 settings card, which reads its OWN live
              useBackupStatus() (liveQuery) hook. `snap.backup` is the read-model
              copy in the adapter snapshot (asserted by T1, part of the composed
              getDiagnostics-style shape); the visible section renders the card,
              not snap.backup — this redundancy is intentional per spec E3.1. */}
          <section className="flex flex-col gap-3" data-testid="diag-backup">
            <h2 className="text-lg font-semibold">Backup</h2>
            <BackupSettingsCard />
          </section>

          {/* Database — verno + per-table counts (14 tables incl. appMeta, expected) */}
          <section className="tap-card flex flex-col gap-3 p-5" data-testid="diag-database">
            <h2 className="text-lg font-semibold">Database</h2>
            <p className="text-sm" data-testid="diag-verno">
              Schema version: {snap.db.verno ?? 'unavailable'}
            </p>
            <div className="group-scroll overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Table</th>
                    <th className="py-1">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.db.tables.map((t) => (
                    <tr key={t.name} data-testid={`diag-table-${t.name}`}>
                      <td className="py-1 font-mono text-xs">{t.name}</td>
                      <td className="py-1">{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Build — build-time version stamp + SW state */}
          <section className="tap-card flex flex-col gap-2 p-5" data-testid="diag-build">
            <h2 className="text-lg font-semibold">Build</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">App version</dt>
              <dd className="font-mono text-xs">{snap.build.version}</dd>
              <dt className="text-muted-foreground">Commit</dt>
              <dd className="font-mono text-xs">{snap.build.sha}</dd>
              <dt className="text-muted-foreground">Built</dt>
              <dd className="font-mono text-xs">{snap.build.builtAt || '—'}</dd>
              <dt className="text-muted-foreground">Service worker</dt>
              <dd className="font-mono text-xs" data-testid="diag-sw">
                {swLabel(snap.sw)}
              </dd>
              <dt className="text-muted-foreground">Precache</dt>
              <dd className="font-mono text-xs">{snap.sw.precacheVersion ?? '—'}</dd>
            </dl>
          </section>

          {/* Error log — the E2 ring buffer + clipboard-only copy button (no network, no download) */}
          <section className="tap-card flex flex-col gap-3 p-5" data-testid="diag-errorlog">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Error log</h2>
              <CopyDiagnosticsButton payload={snap} />
            </div>
            {snap.ring.length === 0 ? (
              <p className="text-xs text-muted-foreground">No errors recorded this session.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {snap.ring.map((e, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only session error ring, never reordered
                    key={`${e.at}-${i}`}
                    className="font-mono text-xs text-muted-foreground"
                    data-testid="diag-ring-entry"
                  >
                    {e.at} [{e.scope}] {e.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Integrity — on-demand doctor (Task 3) */}
          <IntegritySection />

          {/* Multi-device sync status (Track B) */}
          <SyncStatusSection />
        </>
      )}
    </div>
  )
}
