/**
 * Sync client orchestration (Track B, app-side). One `syncOnce` pass:
 *
 *   1. `pull()` the service's canonical state (or null the first time).
 *   2. `dump()` local state — AFTER the pull, so a write that lands during the
 *      (network) pull is included, not clobbered (no TOCTOU window).
 *   3. merge — state tables LWW, the ledger by union (see `merge.ts`), then
 *      reproject each inventory `amount` from the merged ledger so the
 *      `amount === Σ deltas` invariant survives a concurrent cross-device edit.
 *   4. `restore()` the merged dump locally (reuses the tested, Zod-guarded write
 *      path — a merge is a full replace with the union), when remote existed.
 *   5. `push()` the merged dump back as the new canonical.
 *
 * Single-user/multi-device, so this is a pull→merge→push reconcile, not a delta
 * protocol (Phase 2+). No infra is required to run/test it: drive it with an
 * `InMemorySyncTransport` + a real (or fake) `BackupService`.
 *
 * ⚠️ KNOWN LIMITATION (must be resolved before two-way sync goes live): the merge
 * has NO deletion tombstones, so a row deleted on one device is resurrected from
 * the canonical on the next two-way pass. This is safe for **Phase 1 (one-way
 * pull, read-only phone)** — the spec's first milestone — but Phase 2 (two-way)
 * needs tombstones.
 */

import type { DumpV8 } from '@/lib/db/backup'
import { mergeLedger, mergeState } from '@/lib/sync/merge'
import type { SyncPayload, SyncTransport } from '@/lib/sync/transport'

type Tables = DumpV8['tables']

/**
 * Tables that are DEVICE-LOCAL and must NOT cross-merge. `settings` is a
 * per-device singleton (theme/units/gravity display) with no timestamp — LWW
 * can't order two `global` rows, and one device's display prefs shouldn't
 * silently overwrite another's. Kept local (the local row is preserved verbatim
 * in the merged output so restore doesn't wipe it).
 */
const DEVICE_LOCAL_TABLES = new Set<string>(['settings'])

/** Sum each inventory item's merged ledger deltas → the authoritative amount. */
function reprojectAmounts(tables: Tables): void {
  const sumByItem = new Map<string, number>()
  for (const txn of tables.stockTransactions ?? []) {
    sumByItem.set(txn.inventoryItemId, (sumByItem.get(txn.inventoryItemId) ?? 0) + txn.delta)
  }
  for (const it of tables.inventoryItems ?? []) {
    if (sumByItem.has(it.id)) it.amount = Math.max(0, sumByItem.get(it.id) as number)
  }
}

/** Collapse duplicate `opening` txns for the same inventory item (independent
 *  per-device v7 migrations mint different ids for the same logical opening —
 *  union would double-count them and inflate the reprojected amount). Keeps the
 *  earliest opening per item; other reasons are never collapsed. */
function dedupeOpenings(ledger: Tables['stockTransactions']): Tables['stockTransactions'] {
  const seenOpening = new Set<string>()
  const out: Tables['stockTransactions'] = []
  for (const t of ledger) {
    if (t.reason === 'opening') {
      if (seenOpening.has(t.inventoryItemId)) continue
      seenOpening.add(t.inventoryItemId)
    }
    out.push(t)
  }
  return out
}

/**
 * Merge two dump table-sets. Generic over ALL keys present (so no table is ever
 * silently dropped — the output is a superset): the ledger unions + dedupes
 * openings, device-local tables keep the local row, everything else is LWW.
 * Then inventory amounts are reprojected from the merged ledger.
 */
export function mergeDumpTables(local: Tables, remote: Tables): Tables {
  const out = { ...local } as Tables // start from local → superset + keeps device-local + unknown tables
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(remote)])
  for (const key of keys) {
    if (key === 'stockTransactions') {
      out.stockTransactions = dedupeOpenings(
        mergeLedger(local.stockTransactions ?? [], remote.stockTransactions ?? []),
      )
      continue
    }
    if (DEVICE_LOCAL_TABLES.has(key)) continue // keep local (already copied via spread)
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous rows, all carry `id`
    ;(out as any)[key] = mergeState(
      // biome-ignore lint/suspicious/noExplicitAny: index into the dynamic table map
      ((local as any)[key] ?? []) as { id: string }[],
      // biome-ignore lint/suspicious/noExplicitAny: index into the dynamic table map
      ((remote as any)[key] ?? []) as { id: string }[],
    )
  }
  reprojectAmounts(out)
  return out
}

function rowCounts(tables: Tables): Record<string, number> {
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, (v as unknown[]).length]))
}

/** Minimal backup surface `syncOnce` needs (matches `backupService`). */
export interface SyncBackup {
  dump(): Promise<DumpV8>
  restore(d: DumpV8): Promise<void>
}

export interface SyncClientDeps {
  transport: SyncTransport
  backup: SyncBackup
  /** ISO timestamp for this pass (injected for determinism). */
  now: string
}

export interface SyncResult {
  pulled: boolean
  pushed: boolean
  merged: boolean
  lastSyncAt: string
  counts: Record<string, number>
}

export async function syncOnce({ transport, backup, now }: SyncClientDeps): Promise<SyncResult> {
  // Pull FIRST, then snapshot local — so any write during the (network) pull is
  // captured by dump() and merged, never clobbered by restoring a stale snapshot.
  const remote = await transport.pull()
  const local = await backup.dump()

  const mergedTables = remote ? mergeDumpTables(local.tables, remote.tables) : local.tables
  const mergedDump: DumpV8 = {
    version: 8,
    exportedAt: now,
    meta: { ...local.meta, rowCounts: rowCounts(mergedTables) },
    tables: mergedTables,
  }

  if (remote) await backup.restore(mergedDump)
  await transport.push(mergedDump as SyncPayload)

  return {
    pulled: remote !== null,
    pushed: true,
    merged: remote !== null,
    lastSyncAt: now,
    counts: rowCounts(mergedTables),
  }
}
