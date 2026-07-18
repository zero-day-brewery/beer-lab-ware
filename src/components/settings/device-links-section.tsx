'use client'
import { liveQuery } from 'dexie'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Batch } from '@/lib/brewing/types/batch'
import type { DeviceLink } from '@/lib/brewing/types/device-link'
import { batchRepo } from '@/lib/db/repos/batch'
import { deviceLinksRepo } from '@/lib/db/repos/device-links'
import { reportDbError } from '@/lib/diagnostics/error-log'
import { syncMetaRepo } from '@/lib/sync/sync-meta'

function useDeviceLinks(): DeviceLink[] {
  const [links, setLinks] = useState<DeviceLink[]>([])
  useEffect(() => {
    const sub = liveQuery(() => deviceLinksRepo.list()).subscribe({
      next: setLinks,
      error: (e) => reportDbError('deviceLinks', e),
    })
    return () => sub.unsubscribe()
  }, [])
  return links
}

function useBatchesForLinking(): Batch[] {
  const [batches, setBatches] = useState<Batch[]>([])
  useEffect(() => {
    const sub = liveQuery(() => batchRepo.list()).subscribe({
      next: setBatches,
      error: (e) => reportDbError('batches', e),
    })
    return () => sub.unsubscribe()
  }, [])
  return batches
}

/**
 * Normalize a hand-typed device key toward the daemon-derived form (see
 * `reading-ingest.ts` for the derivations): provider prefixes are always
 * lowercase and a Tilt's color part always uppercase, so those variants are
 * safe to auto-correct — `Tilt: red` could never match `tilt:RED` otherwise.
 * The identity part of every OTHER provider (`ispindel:`/`rapt:`/`other:`) is
 * case-SENSITIVE (the daemon preserves the device's own name exactly), so we
 * deliberately leave its case alone and show a persistent hint in the form
 * instead of guessing. A key with no `:` separator can never match anything
 * the daemon derives — rejected (`ok: false`) so the form can explain the
 * expected `provider:identity` shape inline.
 */
function normalizeDeviceKey(raw: string): { ok: true; key: string } | { ok: false } {
  const collapsed = raw.trim().replace(/\s+/g, ' ')
  const sep = collapsed.indexOf(':')
  if (sep === -1) return { ok: false }
  const prefix = collapsed.slice(0, sep).trim().toLowerCase()
  const identity = collapsed.slice(sep + 1).trim()
  return {
    ok: true,
    key: prefix === 'tilt' ? `tilt:${identity.toUpperCase()}` : `${prefix}:${identity}`,
  }
}

/**
 * "Sensor devices" — the UI for `deviceLinksRepo`: assign a normalized
 * `deviceKey` (see `reading-ingest.ts` for exactly how each adapter derives
 * one — `tilt:RED`, `ispindel:iSpindel001`, `rapt:<mac-or-name>`, or anything
 * for the generic shape) to a batch, so the sync daemon's `POST /readings`
 * knows where to file that device's readings. Lives alongside `SyncSection`
 * because it's meaningless without a running daemon — the endpoint hint below
 * SUBSCRIBES (liveQuery, not a one-shot read) to the SAME device-local server
 * URL that card writes, so editing the URL up there updates the hint here.
 */
export function DeviceLinksSection() {
  const links = useDeviceLinks()
  const batches = useBatchesForLinking()
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [deviceKey, setDeviceKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [batchId, setBatchId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Live, not read-once: `SyncSection` persists the URL to appMeta on every
    // valid keystroke, so a value captured at mount goes stale the moment the
    // user edits the Sync card above. liveQuery re-emits on each appMeta
    // write — the endpoint the user copies always reflects the current URL.
    const sub = liveQuery(() => syncMetaRepo.serverUrl()).subscribe({
      next: setServerUrl,
      error: (e) => reportDbError('syncMeta', e),
    })
    return () => sub.unsubscribe()
  }, [])

  const batchLabel = (id: string): string => {
    const b = batches.find((x) => x.id === id)
    return b ? `#${b.batchNo} · ${b.name}` : 'deleted batch'
  }

  /** In-progress batches first in the selectors — they're what a live sensor
   *  almost always feeds. Complete/archived batches stay SELECTABLE (a late
   *  lab reading against a finished batch is legitimate) but carry a status
   *  suffix, so picking one is a choice rather than an accident. Stable sort:
   *  within each group the repo's newest-first order is preserved. */
  const sortedBatches = [...batches].sort(
    (a, b) => (a.status === 'in-progress' ? 0 : 1) - (b.status === 'in-progress' ? 0 : 1),
  )
  const optionLabel = (b: Batch): string =>
    `#${b.batchNo} · ${b.name}${b.status === 'in-progress' ? '' : ` (${b.status})`}`

  const onAssign = async (e: FormEvent) => {
    e.preventDefault()
    const raw = deviceKey.trim()
    if (!raw) {
      toast.error('Device key is required (e.g. tilt:RED)')
      return
    }
    const normalized = normalizeDeviceKey(raw)
    if (!normalized.ok) {
      setKeyError(
        `No ':' in "${raw}" — device keys are provider:identity (e.g. tilt:RED, ispindel:iSpindel001).`,
      )
      return
    }
    if (!batchId) {
      toast.error('Pick a batch to link this device to')
      return
    }
    setSaving(true)
    try {
      await deviceLinksRepo.assign(normalized.key, batchId)
      toast.success(`Linked "${normalized.key}"`)
      setDeviceKey('')
      setBatchId('')
    } catch (err) {
      toast.error(`Link failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const onReassign = async (link: DeviceLink, newBatchId: string) => {
    if (!newBatchId || newBatchId === link.batchId) return
    try {
      await deviceLinksRepo.assign(link.deviceKey, newBatchId)
      toast.success(`"${link.deviceKey}" now feeds ${batchLabel(newBatchId)}`)
    } catch (err) {
      toast.error(`Reassign failed: ${(err as Error).message}`)
    }
  }

  const onRemove = async (link: DeviceLink) => {
    try {
      await deviceLinksRepo.remove(link.id)
      toast.success(`Unlinked "${link.deviceKey}"`)
    } catch (err) {
      toast.error(`Unlink failed: ${(err as Error).message}`)
    }
  }

  const endpointHint = `${serverUrl ?? '<your sync server>'}/readings`

  return (
    <section className="tap-card flex flex-col gap-4 p-5" data-testid="device-links-section">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">🌡️ Automatic readings</span>
        <h2 className="text-lg font-semibold">Sensor devices</h2>
        <p className="text-sm text-muted-foreground">
          Link a Tilt (via TiltBridge/Tilt Pi), an iSpindel, a RAPT Pill, or any script that speaks
          the generic JSON shape to a batch — the sync daemon appends its readings automatically.
          Requires the sync daemon above; a static install alone can't receive pushes (see{' '}
          <code className="font-mono">docs/sensors.md</code>).
        </p>
      </div>

      <p
        className="rounded-md border border-border/70 bg-card/40 p-3 text-xs text-muted-foreground"
        data-testid="device-links-howto"
      >
        Point your device's HTTP/"Custom" or "Brewfather" target at{' '}
        <code className="font-mono">{endpointHint}</code> with your device token as a Bearer token.
        The device identifies itself automatically (Tilt color, iSpindel name, …) — link its key
        below once you see it in a failed/unlinked ingest, or enter it ahead of time (e.g.{' '}
        <code className="font-mono">tilt:RED</code>,{' '}
        <code className="font-mono">ispindel:iSpindel001</code>
        ).
      </p>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No devices linked yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="device-links-list">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 p-3"
              data-testid={`device-link-${link.deviceKey}`}
            >
              <code className="font-mono text-sm">{link.deviceKey}</code>
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                →
              </span>
              <select
                aria-label={`Batch for ${link.deviceKey}`}
                value={link.batchId}
                onChange={(e) => void onReassign(link, e.target.value)}
                className="field min-w-[10rem] flex-1"
              >
                {!batches.some((b) => b.id === link.batchId) && (
                  <option value={link.batchId}>{batchLabel(link.batchId)}</option>
                )}
                {sortedBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {optionLabel(b)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void onRemove(link)}
                aria-label={`Unlink ${link.deviceKey}`}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={onAssign}
        className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-3"
      >
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
          <span className="text-sm font-medium">Device key</span>
          <input
            type="text"
            aria-label="Device key"
            autoComplete="off"
            placeholder="tilt:RED"
            value={deviceKey}
            onChange={(e) => {
              setKeyError(null)
              setDeviceKey(e.target.value)
            }}
            className="field"
          />
          {keyError && (
            <span className="text-xs text-destructive" role="alert" data-testid="device-key-error">
              {keyError}
            </span>
          )}
          <span className="text-xs text-muted-foreground" data-testid="device-key-hint">
            Case matters after the <code className="font-mono">provider:</code> prefix (Tilt colors
            excepted) — enter the key exactly as an unlinked-ingest response reports it.
          </span>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
          <span className="text-sm font-medium">Batch</span>
          <select
            aria-label="Batch"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="field"
          >
            <option value="">Select a batch…</option>
            {sortedBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {optionLabel(b)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary disabled:opacity-50" disabled={saving}>
          {saving ? 'Linking…' : 'Link device'}
        </button>
      </form>
    </section>
  )
}
