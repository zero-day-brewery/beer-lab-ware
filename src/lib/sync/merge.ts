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
 * DumpV8 envelope and writes the result through the tested `backupService`.
 */

interface WithId {
  id: string
}

/** LWW timestamp for a row: `updatedAt`, else `at`, else `createdAt`, else 0
 *  (a timestamp-less row is treated as oldest, so a dated row always wins). */
function tsOf(row: Record<string, unknown>): number {
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
 */
export function mergeState<T extends WithId>(local: T[], remote: T[]): T[] {
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
  return [...byId.values()]
}

/**
 * Merge two append-only ledgers: set-union by immutable txn `id` (a shared id is
 * the same event on both devices — keep one), sorted ascending by `at` so the
 * running-balance timeline stays chronological.
 */
export function mergeLedger<T extends WithId & { at?: string }>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>()
  for (const t of local) byId.set(t.id, t)
  for (const t of remote) if (!byId.has(t.id)) byId.set(t.id, t)
  return [...byId.values()].sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0
    const tb = b.at ? Date.parse(b.at) : 0
    return ta - tb
  })
}
