/**
 * Sync client orchestration (Track B, app-side). One `syncOnce` pass:
 *
 *   1. `pull()` the service's canonical state (or null the first time).
 *   2. `dump()` local state — AFTER the pull, so a write that lands during the
 *      (network) pull is included, not clobbered (no TOCTOU window).
 *   3. merge — state tables LWW, the ledger by union (see `merge.ts`), then
 *      reproject each inventory `amount` from the merged ledger so the
 *      `amount === Σ deltas` invariant survives a concurrent cross-device edit.
 *      When the union of two devices' concurrent deductions drives an item's
 *      ledger sum negative, a deterministic `sync-reconcile` compensating
 *      transaction is appended (never a silent clamp) — see `reprojectAmounts`.
 *   4. `snapshot()` a pre-restore safety backup of the LOCAL state, ONLY when a
 *      restore is about to happen (step 5) — so a bad merge is always
 *      recoverable through the existing restore path.
 *   5. `restore()` the merged dump locally (reuses the tested, Zod-guarded write
 *      path — a merge is a full replace with the union), when remote existed.
 *   6. `push()` the merged dump back as the new canonical, conditioned on the
 *      etag observed in step 1 (optimistic concurrency — see below).
 *
 * Single-user/multi-device, so this is a pull→merge→push reconcile, not a delta
 * protocol (Phase 2+). No infra is required to run/test it: drive it with an
 * `InMemorySyncTransport` + a real (or fake) `BackupService`/snapshot fn.
 *
 * Optimistic concurrency (closing the lost-update race): the daemon's `PUT
 * /state` requires an `If-Match` precondition (`sync-server.ts`) — if another
 * device pushed between THIS pass's pull and its own push, the push is
 * rejected (412) instead of silently clobbering the other device's write. On a
 * 412, `syncOnce` re-pulls, re-merges (steps 1-5 all run again — including
 * `sync-reconcile`), and retries the push with the fresh etag, bounded to
 * `MAX_PUSH_ATTEMPTS` total attempts before throwing a typed
 * `SyncPushConflictError`. Every retry re-dumps local state too (not just the
 * remote), for the same TOCTOU reason step 2 does on the first pass — a local
 * write landing during a retry's network round-trip must never be clobbered.
 *
 * ⚠️ KNOWN LIMITATION (must be resolved before two-way sync goes live): the merge
 * has NO deletion tombstones, so a row deleted on one device is resurrected from
 * the canonical on the next two-way pass. This is safe for **Phase 1 (one-way
 * pull, read-only phone)** — the spec's first milestone — but Phase 2 (two-way)
 * needs tombstones.
 */

import { v5 as uuidv5 } from 'uuid'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import type { DumpV8 } from '@/lib/db/backup'
import { mergeLedger, mergeState } from '@/lib/sync/merge'
import type { SyncPayload, SyncPushResult, SyncTransport } from '@/lib/sync/transport'

type Tables = DumpV8['tables']

/**
 * Tables that are DEVICE-LOCAL and must NOT cross-merge. `settings` is a
 * per-device singleton (theme/units/gravity display) with no timestamp — LWW
 * can't order two `global` rows, and one device's display prefs shouldn't
 * silently overwrite another's. Kept local (the local row is preserved verbatim
 * in the merged output so restore doesn't wipe it).
 */
const DEVICE_LOCAL_TABLES = new Set<string>(['settings'])

/** Tolerance for float drift when deciding a ledger sum is "actually negative"
 *  (matches the epsilon `assertLedgerInvariant`/doctor C1 use — never `===`). */
const EPSILON = 1e-6

/**
 * Fixed namespace UUID for `sync-reconcile` compensating-transaction ids
 * (RFC 4122 v5, name-based). Any stable UUID works as a namespace; this one is
 * dedicated to this feature so its ids never collide with ids minted elsewhere
 * (v4/random via `newId()`).
 */
const RECONCILE_NAMESPACE = '2f6b8e2a-3c1d-4b7e-9a5f-6d8c0e1f2a3b'

/**
 * Deterministic id for the compensating transaction that reconciles inventory
 * item `itemId`'s ledger, given the sorted ids of every txn (for that item)
 * that sum to the negative total. A v5 (name-based, not random) UUID: hashing
 * `${itemId}:${sortedSourceIds.join(',')}` means two devices independently
 * reconciling the SAME conflict — same item, same underlying txn ids — always
 * derive the SAME id, so `mergeLedger`'s union-by-id collapses their two
 * (byte-identical) compensations into ONE instead of double-compensating.
 */
function reconcileTxnId(itemId: string, sourceTxnIds: readonly string[]): string {
  const name = `${itemId}:${[...sourceTxnIds].sort().join(',')}`
  return uuidv5(name, RECONCILE_NAMESPACE)
}

/**
 * Sum each inventory item's merged ledger deltas → the authoritative amount.
 *
 * Two devices deducting the same item concurrently are each locally
 * consistent alone, but the ledger UNION can double-deduct: Σdeltas goes
 * negative even though neither device could have seen the other's brew.
 * Silently clamping `amount` to `Math.max(0, Σ)` (the old behavior) breaks
 * `amount === Σdeltas` FOREVER — every subsequent push then fails the
 * server's `assertLedgerInvariant` (brewery-store.ts) with an HTTP 400, and
 * there is no way for the client to un-wedge itself.
 *
 * Fix: when Σdeltas for an item is negative, append a deterministic
 * `sync-reconcile` transaction that brings Σdeltas up to the floor (0) —
 * never a clamp that diverges from the ledger. Every field is a pure
 * function of the (already-merged, already-sorted) contributing txns — no
 * wall-clock/device input — so two devices reconciling the same conflict
 * independently produce byte-identical transactions (see `reconcileTxnId`).
 */
function reprojectAmounts(tables: Tables): void {
  const txnsByItem = new Map<string, StockTransaction[]>()
  for (const txn of tables.stockTransactions ?? []) {
    const list = txnsByItem.get(txn.inventoryItemId)
    if (list) list.push(txn)
    else txnsByItem.set(txn.inventoryItemId, [txn])
  }

  const reconciliations: StockTransaction[] = []
  for (const it of tables.inventoryItems ?? []) {
    const txns = txnsByItem.get(it.id)
    if (!txns) continue

    // Sort by (at, id) — a total order independent of which side was "local"
    // vs "remote" in the union — so the sum (and thus the compensating
    // delta) is bit-for-bit identical no matter which device computes it.
    const sorted = [...txns].sort((a, b) => {
      const byAt = Date.parse(a.at) - Date.parse(b.at)
      return byAt !== 0 ? byAt : a.id.localeCompare(b.id)
    })
    const sum = sorted.reduce((s, t) => s + t.delta, 0)

    if (sum < -EPSILON) {
      const sourceIds = sorted.map((t) => t.id)
      const latestAt = sorted[sorted.length - 1].at
      reconciliations.push({
        id: reconcileTxnId(it.id, sourceIds),
        inventoryItemId: it.id,
        kind: it.ingredientKind,
        delta: -sum,
        unit: it.amountUnit,
        reason: 'sync-reconcile',
        note: 'Auto-reconciled by sync merge: concurrent deductions exceeded on-hand stock.',
        at: latestAt,
        schemaVersion: 1,
      })
      it.amount = 0
    } else {
      it.amount = Math.max(0, sum)
    }
  }

  if (reconciliations.length > 0) {
    tables.stockTransactions = [...(tables.stockTransactions ?? []), ...reconciliations]
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
  /**
   * Pre-restore safety snapshot. Called immediately BEFORE `backup.restore()`
   * overwrites the local DB with the merged dump — a merge restore is a full
   * replace, so without a pre-image a bad merge has no recovery path. Never
   * called when no restore will happen (a first/solo sync, `remote === null`).
   * In production wire this to `runBackup` (`src/lib/storage/backup-run.ts`),
   * which already rotates via `KEEP_LAST` — this hook only decides WHEN to
   * snapshot, it intentionally does not reimplement storage/rotation.
   */
  snapshot: () => Promise<unknown>
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

/** Total PUT attempts `syncOnce` makes before giving up on a persistently
 *  stale precondition (1 initial attempt + up to 2 retries). Each retry
 *  re-pulls + re-merges against the fresh remote first (see module doc), so a
 *  retry only recurs when a DIFFERENT writer keeps winning the race — a
 *  genuinely pathological/contended scenario, not routine operation. */
const MAX_PUSH_ATTEMPTS = 3

/**
 * Thrown when `syncOnce` cannot land its push: either the daemon rejected
 * every attempt with a stale precondition (412, `MAX_PUSH_ATTEMPTS` exhausted
 * — an unusually contended run of competing writers) or rejected the FIRST
 * attempt outright for missing a precondition (428 — a client/transport bug,
 * since `syncOnce` always supplies one; never retried, since retrying an
 * omitted precondition can't self-correct). Local state is never left corrupt
 * on this failure: any restore that happened used a properly snapshotted,
 * already-merged dump, and the only thing that DIDN'T happen is publishing it
 * as canonical — the next `syncOnce` call (manual retry, or the app's regular
 * sync cadence) will try again from fresh state.
 */
export class SyncPushConflictError extends Error {
  readonly attempts: number
  readonly lastStatus: 412 | 428
  readonly currentEtag: string | null

  constructor(attempts: number, lastStatus: 412 | 428, currentEtag: string | null = null) {
    super(
      lastStatus === 412
        ? `sync push failed after ${attempts} attempt(s): a competing writer keeps winning the precondition race`
        : 'sync push failed: the server requires an If-Match precondition (428) — client/transport protocol mismatch',
    )
    this.name = 'SyncPushConflictError'
    this.attempts = attempts
    this.lastStatus = lastStatus
    this.currentEtag = currentEtag
  }
}

interface PullMergeRestorePass {
  mergedDump: DumpV8
  etag: string | null
  pulled: boolean
  merged: boolean
}

/** One full pull → dump-local → merge → (snapshot + restore) pass, WITHOUT the
 *  push. Used for both the initial attempt and every 412 retry — a retry needs
 *  to see the freshest remote AND the freshest local (a local write landing
 *  during a retry's network round-trip must never be clobbered, same TOCTOU
 *  reasoning as the very first pass). */
async function pullMergeRestore(
  transport: SyncTransport,
  backup: SyncBackup,
  snapshot: () => Promise<unknown>,
  now: string,
): Promise<PullMergeRestorePass> {
  // Pull FIRST, then dump local — so any write during the (network) pull is
  // captured by dump() and merged, never clobbered by restoring a stale snapshot.
  const { payload: remote, etag } = await transport.pull()
  const local = await backup.dump()

  const mergedTables = remote ? mergeDumpTables(local.tables, remote.tables) : local.tables
  const mergedDump: DumpV8 = {
    version: 8,
    exportedAt: now,
    meta: { ...local.meta, rowCounts: rowCounts(mergedTables) },
    tables: mergedTables,
  }

  // A restore only happens when there's a remote to merge against — snapshot
  // right before it, and ONLY then, so the user can always recover the
  // pre-sync local state (see `SyncClientDeps.snapshot`).
  if (remote) {
    await snapshot()
    await backup.restore(mergedDump)
  }

  return { mergedDump, etag, pulled: remote !== null, merged: remote !== null }
}

export async function syncOnce({
  transport,
  backup,
  snapshot,
  now,
}: SyncClientDeps): Promise<SyncResult> {
  let pass = await pullMergeRestore(transport, backup, snapshot, now)

  for (let attempt = 1; ; attempt++) {
    const result: SyncPushResult = await transport.push(pass.mergedDump as SyncPayload, pass.etag)

    if (result.ok) {
      return {
        pulled: pass.pulled,
        pushed: true,
        merged: pass.merged,
        lastSyncAt: now,
        counts: rowCounts(pass.mergedDump.tables),
      }
    }

    // 412: another writer landed between our pull and our push. Re-pull +
    // re-merge (the full machinery, including sync-reconcile) and retry with
    // the fresh etag — bounded, so a pathologically contended run still
    // terminates instead of retrying forever.
    if (result.status === 412 && attempt < MAX_PUSH_ATTEMPTS) {
      pass = await pullMergeRestore(transport, backup, snapshot, now)
      continue
    }

    // Either retries are exhausted (412) or the server rejected the FIRST
    // attempt outright for a missing precondition (428, never retried — see
    // SyncPushConflictError doc).
    throw new SyncPushConflictError(
      attempt,
      result.status,
      result.status === 412 ? result.currentEtag : null,
    )
  }
}
