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
 * ✅ RESOLVED (deletion tombstones): the merge now carries `rowTombstones`
 * (DumpV9) so a row deleted on one device is never resurrected from another
 * device's stale, pre-delete copy — see `mergeDumpTables` below and the
 * suppression logic in `mergeState`/`mergeLedger`/`mergeTombstones`
 * (sync/merge.ts). Every repo delete path writes a tombstone in the same
 * Dexie transaction as the delete (db/repos/*.ts); a stock-transaction
 * cascade delete tombstones the cascaded ledger rows too. A row edited/
 * created AFTER its tombstone's `deletedAt` beats the tombstone and survives
 * (edit-after-delete, LWW-symmetric with every other timestamp comparison
 * this module makes) — and, like every other timestamp comparison here, this
 * is WALL-CLOCK based: if a device's clock is badly skewed, an edit made
 * "before" a delete by wall-clock-but-after in real time could still lose to
 * the tombstone (or vice versa). Tombstones GC after `TOMBSTONE_RETENTION_MS`
 * once no input dump still references the row they suppress (bounded growth
 * — see `mergeDumpTables`). This closes the two-way-sync gate: two-way sync
 * itself is still pending in-app connection UI (see README).
 *
 * ⚠️ Known limitation (cascade-tombstone visibility): a device's cascade
 * delete (e.g. deleting an inventory item — see `db/repos/inventory.ts` /
 * `stock-transactions.ts`) can only tombstone the ledger rows THAT DEVICE
 * could see at delete time. A ledger row created on a THIRD device that
 * never synced with the deleter is never a candidate for that cascade, so it
 * survives as an untombstoned "orphan". If the item itself also survives the
 * same merge (edit-after-delete), that orphan row legitimately rejoins the
 * item's Σ through `reprojectAmounts`'s normal (≥1-surviving-txn) path below
 * — same as any other surviving ledger row. This is NOT a wedge (`amount ===
 * Σdeltas` still holds; `reprojectAmounts` still reprojects correctly from
 * whatever the ledger union actually contains) but it does mean a
 * device-scoped cascade cannot guarantee it purges an item's ledger history
 * fleet-wide — only the portion the deleting device had visibility into.
 * `reprojectAmounts`'s OWN doc comment below covers the (fixed) sibling bug
 * this could otherwise combine with: an item surviving with ZERO surviving
 * ledger rows now reconciles (restarts from a preserved-amount "opening")
 * instead of leaving `amount !== Σdeltas` wedged forever.
 */

import { v5 as uuidv5 } from 'uuid'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import type { DumpV9 } from '@/lib/db/backup'
import { mergeLedger, mergeState, mergeTombstones, type RowTombstone } from '@/lib/sync/merge'
import type { SyncPayload, SyncPushResult, SyncTransport } from '@/lib/sync/transport'

type Tables = DumpV9['tables']

/**
 * Retention window for a tombstone once it no longer matches a row in either
 * side of a merge (see the GC pass in `mergeDumpTables`): 180 days. Chosen to
 * comfortably outlast any plausibly-offline device (a phone left untouched
 * for months) while still bounding tombstone-table growth over years of use.
 */
const TOMBSTONE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000

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
 * item `itemId`'s ledger to `targetAmount`, given the sorted ids of every
 * SURVIVING txn (post-tombstone-suppression) contributing to the sum being
 * reconciled. A v5 (name-based, not random) UUID: hashing
 * `${itemId}:${sortedSourceIds.join(',')}:${targetAmount}` means two devices
 * independently reconciling the SAME conflict — same item, same surviving
 * txn ids, same post-LWW target amount — always derive the SAME id, so
 * `mergeLedger`'s union-by-id collapses their two (byte-identical)
 * compensations into ONE instead of double-compensating. `targetAmount` is
 * part of the hash (not just the source ids) so a LATER merge round that
 * reconciles the SAME item to a DIFFERENT target (e.g. the item was edited
 * again) mints a genuinely NEW id instead of being silently deduped against
 * a stale compensation for a now-wrong target.
 */
function reconcileTxnId(
  itemId: string,
  sourceTxnIds: readonly string[],
  targetAmount: number,
): string {
  const name = `${itemId}:${[...sourceTxnIds].sort().join(',')}:${targetAmount}`
  return uuidv5(name, RECONCILE_NAMESPACE)
}

/**
 * Reconcile each inventory item's `amount` against its merged ledger so
 * `amount === Σdeltas` ALWAYS holds after a merge — never a silent clamp
 * that diverges from the ledger, and never a value left un-reconciled just
 * because there's nothing to reproject FROM. Two cases mint a deterministic
 * `sync-reconcile` compensating transaction (never a plain overwrite):
 *
 *  1. NEGATIVE Σ (concurrent double-deduction race): two devices deducting
 *     the same item concurrently are each locally consistent alone, but the
 *     ledger UNION can double-deduct — Σdeltas goes negative even though
 *     neither device could have seen the other's brew. The floor is 0 (can't
 *     have negative stock); the item's own (possibly stale, single-device)
 *     `amount` is NOT trusted here — the ledger is authoritative.
 *
 *  2. ZERO surviving ledger rows for a still-live item: a cascade delete on
 *     ANOTHER device (see `db/repos/stock-transactions.ts` /
 *     `db/repos/inventory.ts`) tombstoned every one of this item's txns
 *     while the item itself SURVIVED the same merge via edit-after-delete
 *     (its own timestamp beat the item's tombstone — see sync/merge.ts).
 *     There's nothing in the ledger to trust in this case: the item WON LWW,
 *     so its user-edited `amount` is the trustworthy signal — preserve it
 *     (never silently zero real stock just because history was cascaded
 *     away) and restart the ledger from a reconciled "opening".
 *
 * Every other case (≥1 surviving txn, non-negative Σ) reprojects `amount`
 * from Σ as before — the ledger is authoritative once it has ANY surviving
 * history to be authoritative FROM.
 *
 * ⚠️ Known limitation (documented, not fixed — see coordinator review): a
 * cascade delete only tombstones the ledger rows the DELETING device could
 * see. A ledger row created on a THIRD device that never synced with the
 * deleter (so was never a candidate for that device's cascade) survives as
 * an untombstoned "orphan" and — if the item itself also survives via
 * edit-after-delete — legitimately rejoins Σ through the normal
 * ≥1-surviving-txn path above, same as any other surviving row. This is not
 * a wedge (the invariant still holds, `amount` still reprojects correctly
 * from whatever the ledger union actually contains) but it does mean a
 * device-scoped cascade cannot GUARANTEE it purges 100% of an item's history
 * fleet-wide — only the portion the deleting device had visibility into.
 *
 * Every field minted here is a pure function of the (already-merged,
 * already-sorted) contributing txns + the item's own post-LWW state — no
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
    const txns = txnsByItem.get(it.id) ?? []

    // Sort by (at, id) — a total order independent of which side was "local"
    // vs "remote" in the union — so the sum (and thus any compensating
    // delta) is bit-for-bit identical no matter which device computes it.
    const sorted = [...txns].sort((a, b) => {
      const byAt = Date.parse(a.at) - Date.parse(b.at)
      return byAt !== 0 ? byAt : a.id.localeCompare(b.id)
    })
    const sum = sorted.reduce((s, t) => s + t.delta, 0)

    let target: number
    let note: string
    if (sum < -EPSILON) {
      target = 0
      note = 'Auto-reconciled by sync merge: concurrent deductions exceeded on-hand stock.'
    } else if (sorted.length === 0) {
      target = it.amount
      note =
        "Auto-reconciled by sync merge: this item's ledger history was cascade-deleted on " +
        'another device while the item itself survived (edit-after-delete) — restarted from ' +
        'a reconciled opening.'
    } else {
      target = Math.max(0, sum)
      note = ''
    }

    if (Math.abs(target - sum) > EPSILON) {
      const sourceIds = sorted.map((t) => t.id)
      const latestAt = sorted.length > 0 ? sorted[sorted.length - 1].at : it.updatedAt
      reconciliations.push({
        id: reconcileTxnId(it.id, sourceIds, target),
        inventoryItemId: it.id,
        kind: it.ingredientKind,
        delta: target - sum,
        unit: it.amountUnit,
        reason: 'sync-reconcile',
        note,
        at: latestAt,
        schemaVersion: 1,
      })
    }
    it.amount = target
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

/** Bucket a merged tombstone list by `table`, id→`deletedAt`, for O(1)
 *  per-table lookup while merging each table's rows. */
function bucketByTable(tombstones: readonly RowTombstone[]): Map<string, Map<string, string>> {
  const byTable = new Map<string, Map<string, string>>()
  for (const t of tombstones) {
    let byId = byTable.get(t.table)
    if (!byId) {
      byId = new Map()
      byTable.set(t.table, byId)
    }
    byId.set(t.id, t.deletedAt)
  }
  return byTable
}

/** Rows of a dynamic (unknown-at-compile-time) table key, defaulting to `[]`. */
function rowsOf(tables: Tables, key: string): { id: string }[] {
  // biome-ignore lint/suspicious/noExplicitAny: index into the dynamic table map
  return (((tables as any)[key] ?? []) as { id: string }[]) ?? []
}

/**
 * Merge two dump table-sets. Generic over ALL keys present (so no table is ever
 * silently dropped — the output is a superset): the ledger unions + dedupes
 * openings, device-local tables keep the local row, everything else is LWW.
 * Tombstones (`rowTombstones`) are handled as their own pass — merged first
 * (union by table+id, LWW by `deletedAt`), then used to suppress any
 * resurrected row in every other table's merge, then reconciled:
 *   - a tombstone whose row SURVIVED (present in the merged output — only
 *     possible when that row's own timestamp beat `deletedAt`) is SUPERSEDED
 *     and dropped;
 *   - a tombstone that's not superseded is GC'd once it's older than
 *     `TOMBSTONE_RETENTION_MS` AND no longer matches a row in EITHER original
 *     input (never GC one still needed to suppress a device that hasn't
 *     synced the deletion yet — see `mergeState`/`mergeLedger`'s tombstone
 *     param in sync/merge.ts).
 * Then inventory amounts are reprojected from the merged ledger.
 *
 * `now` (ISO, default wall-clock) drives ONLY the GC age check — injected for
 * determinism/testability, matching this module's other `now` plumbing.
 */
export function mergeDumpTables(
  local: Tables,
  remote: Tables,
  now: string = new Date().toISOString(),
): Tables {
  const out = { ...local } as Tables // start from local → superset + keeps device-local + unknown tables
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(remote)])

  const mergedTombstones = mergeTombstones(local.rowTombstones ?? [], remote.rowTombstones ?? [])
  const tombstonesByTable = bucketByTable(mergedTombstones)

  for (const key of keys) {
    if (key === 'rowTombstones') continue // handled as its own pass, see below
    if (key === 'stockTransactions') {
      out.stockTransactions = dedupeOpenings(
        mergeLedger(
          local.stockTransactions ?? [],
          remote.stockTransactions ?? [],
          tombstonesByTable.get('stockTransactions'),
        ),
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
      tombstonesByTable.get(key),
    )
  }

  // Supersede: a tombstone whose row survived in the merged OUTPUT can only
  // have survived because its timestamp beat `deletedAt` (mergeState/
  // mergeLedger already suppressed every at-or-before match) — it's stale,
  // drop it.
  const notSuperseded = mergedTombstones.filter(
    (t) => !rowsOf(out, t.table).some((r) => r.id === t.id),
  )

  // GC: drop a not-superseded tombstone once it's older than the retention
  // window AND no longer referenced by a row in EITHER original input — that
  // means the deletion has fully propagated (no stale device copy is still
  // relying on this tombstone to stay suppressed).
  const nowMs = Date.parse(now)
  out.rowTombstones = notSuperseded.filter((t) => {
    const ageMs = nowMs - Date.parse(t.deletedAt)
    if (!(ageMs > TOMBSTONE_RETENTION_MS)) return true
    const stillReferenced =
      rowsOf(local, t.table).some((r) => r.id === t.id) ||
      rowsOf(remote, t.table).some((r) => r.id === t.id)
    return stillReferenced
  })

  reprojectAmounts(out)
  return out
}

function rowCounts(tables: Tables): Record<string, number> {
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, (v as unknown[]).length]))
}

/** Minimal backup surface `syncOnce` needs (matches `backupService`). */
export interface SyncBackup {
  dump(): Promise<DumpV9>
  restore(d: DumpV9): Promise<void>
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
  mergedDump: DumpV9
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

  const mergedTables = remote ? mergeDumpTables(local.tables, remote.tables, now) : local.tables
  const mergedDump: DumpV9 = {
    version: 9,
    exportedAt: now,
    meta: { ...local.meta, rowCounts: rowCounts(mergedTables) },
    tables: mergedTables,
  }

  // A restore only happens when there's a remote to merge against — snapshot
  // right before it, and ONLY then, so the user can always recover the
  // pre-sync local state (see `SyncClientDeps.snapshot`).
  //
  // Deliberately NO `bumpTimestamps` option here (see backup.ts's `restore()`
  // doc) — this restore just writes the ALREADY-MERGED dump back to Dexie, it
  // is not a user-initiated backup import. Bumping every row's timestamp on
  // every routine sync pass would make every row look newest on every sync,
  // destroying LWW ordering across devices.
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
