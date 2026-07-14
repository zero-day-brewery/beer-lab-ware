'use client'
import { useEffect, useState } from 'react'

import { syncMetaRepo } from '@/lib/sync/sync-meta'

/**
 * Multi-device sync status (Track B). The app-side sync client is built + tested,
 * but your self-hosted sync server is provisioned separately — until it is,
 * this shows the device identity + last sync and reports the service as
 * not-yet-configured. Honest about the phase.
 */
export function SyncStatusSection() {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const [id, last] = await Promise.all([syncMetaRepo.deviceId(), syncMetaRepo.lastSyncAt()])
      if (!live) return
      setDeviceId(id)
      setLastSyncAt(last)
    })()
    return () => {
      live = false
    }
  }, [])

  return (
    <section className="tap-card flex flex-col gap-3 p-5" data-testid="diag-sync">
      <h2 className="text-lg font-semibold">Multi-device sync</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Device ID</dt>
        <dd className="font-mono text-xs" data-testid="diag-sync-device">
          {deviceId ? `${deviceId.slice(0, 8)}…` : '—'}
        </dd>
        <dt className="text-muted-foreground">Last sync</dt>
        <dd data-testid="diag-sync-last">
          {lastSyncAt ? lastSyncAt.slice(0, 19).replace('T', ' ') : 'never'}
        </dd>
        <dt className="text-muted-foreground">Service</dt>
        <dd data-testid="diag-sync-service">sync server not configured</dd>
      </dl>
    </section>
  )
}
