/**
 * Sync merge engine — pure, portable (no DOM/Dexie/fetch).
 *
 * Single-user, multi-device sync: no two people edit at once, so the conflict
 * model is deliberately simple and needs no CRDT:
 *  - **State tables** (recipes, inventory, batches, yeast lots, …) merge
 *    last-write-wins by a per-row timestamp, unioned by id. See {@link mergeState}.
 *  - **The stock ledger** is an append-only event log, so it merges by set-union
 *    on the immutable txn id — never LWW. See {@link mergeLedger}.
 *
 * These operate on plain rows; `sync-client.ts` applies them across a whole
 * DumpV10 envelope and writes the result through the tested `backupService`.
 * A THIRD kind of merge, deletion tombstones, closes the resurrection gap the
 * first two leave open on their own: see {@link mergeTombstones} and the
 * `tombstones` param on `mergeState`/`mergeLedger` below.
 */

interface WithId {
  id: string
}

/**
 * A tombstone recording a row's deletion. `table` scopes `id` (the deleted
 * row's own id, not a synthesized key) so two different tables' rows can
 * never collide in a tombstone-suppression lookup even though every table's
 * ids are drawn from the same UUID pool. Structurally identical to (but
 * deliberately NOT importing) `RowTombstone` from `db/schema.ts` — this
 * module stays Dexie-free, per the file header.
 */
export interface RowTombstone {
  id: string
  table: string
  deletedAt: string // ISO
}

/** LWW timestamp for a row: `updatedAt`, else `at`, else `createdAt`, else 0
 *  (a timestamp-less row is treated as oldest, so a dated row always wins). */
export function tsOf(row: Record<string, unknown>): number {
  const raw =
    (typeof row.updatedAt === 'string' && row.updatedAt) ||
    (typeof row.at === 'string' && row.at) ||
    (typeof row.createdAt === 'string' && row.createdAt) ||
    ''
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Merge two sets of state rows: union by `id`, and for an id present on both
 * sides keep the row with the greater timestamp. An exact tie keeps `local`
 * (deterministic — the caller passes its own rows as `local`).
 *
 * `tombstones` (optional) is an id→`deletedAt` (ISO) map SCOPED to this
 * table (the caller buckets a merged `RowTombstone[]` by `table` before
 * calling — see `mergeDumpTables`). After the union, any survivor whose
 * timestamp is AT OR BEFORE its tombstone's `deletedAt` is dropped — a
 * tombstone beats a tie, closing the resurrection bug (a row deleted on one
 * device reappearing from another device's stale, pre-delete copy). A row
 * edited/created STRICTLY AFTER `deletedAt` beats the tombstone and survives
 * (edit-after-delete), matching this module's LWW-by-timestamp convention.
 */
export function mergeState<T extends WithId>(
  local: T[],
  remote: T[],
  tombstones?: ReadonlyMap<string, string>,
): T[] {
  const byId = new Map<string, T>()
  for (const r of local) byId.set(r.id, r)
  for (const r of remote) {
    const existing = byId.get(r.id)
    if (!existing) {
      byId.set(r.id, r)
      continue
    }
    // remote strictly newer replaces local; tie/older keeps local
    if (tsOf(r as Record<string, unknown>) > tsOf(existing as Record<string, unknown>)) {
      byId.set(r.id, r)
    }
  }
  if (tombstones && tombstones.size > 0) {
    for (const [id, deletedAtIso] of tombstones) {
      const row = byId.get(id)
      if (row && tsOf(row as Record<string, unknown>) <= Date.parse(deletedAtIso)) {
        byId.delete(id)
      }
    }
  }
  return [...byId.values()]
}

/**
 * Merge two append-only ledgers: set-union by immutable txn `id` (a shared id is
 * the same event on both devices — keep one), sorted ascending by `at` so the
 * running-balance timeline stays chronological.
 *
 * `tombstones` (optional, same shape/semantics as `mergeState`'s) suppresses a
 * ledger row — keyed by the txn's own immutable `id` — that is at-or-before
 * its tombstone's `deletedAt` (by `at`). This is how a CASCADE delete (e.g. an
 * inventory item's ledger rows, tombstoned alongside the item — see
 * `stock-transactions.ts`) keeps those rows from resurrecting too.
 */
export function mergeLedger<T extends WithId & { at?: string }>(
  local: T[],
  remote: T[],
  tombstones?: ReadonlyMap<string, string>,
): T[] {
  const byId = new Map<string, T>()
  for (const t of local) byId.set(t.id, t)
  for (const t of remote) if (!byId.has(t.id)) byId.set(t.id, t)
  if (tombstones && tombstones.size > 0) {
    for (const [id, deletedAtIso] of tombstones) {
      const row = byId.get(id)
      if (row) {
        const ts = row.at ? Date.parse(row.at) : 0
        if (ts <= Date.parse(deletedAtIso)) byId.delete(id)
      }
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0
    const tb = b.at ? Date.parse(b.at) : 0
    return ta - tb
  })
}

/**
 * Merge two tombstone sets: union by (`table`,`id`) — a row can only ever be
 * tombstoned once per table, so this key is exactly as unique as a state
 * row's `id` is within one table. On a same-(table,id) collision, keep the
 * LATER `deletedAt`; an exact tie keeps `local` (mirrors `mergeState`'s tie
 * rule). Both sides' tombstones otherwise survive verbatim — GC (dropping
 * tombstones nothing references anymore, after a retention window) is a
 * separate pass in `mergeDumpTables`, not this function's job.
 */
export function mergeTombstones(local: RowTombstone[], remote: RowTombstone[]): RowTombstone[] {
  const key = (t: RowTombstone) => `${t.table} ${t.id}`
  const byKey = new Map<string, RowTombstone>()
  for (const t of local) byKey.set(key(t), t)
  for (const t of remote) {
    const k = key(t)
    const existing = byKey.get(k)
    if (!existing || Date.parse(t.deletedAt) > Date.parse(existing.deletedAt)) {
      byKey.set(k, t)
    }
  }
  return [...byKey.values()]
}
