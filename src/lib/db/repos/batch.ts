import type { Batch } from '@/lib/brewing/types/batch'
import { BatchSchema } from '@/lib/brewing/types/batch'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeBatchRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<Batch | null> {
      const row = await database.batches.get(id)
      return row ? BatchSchema.parse(row) : null
    },
    async list(): Promise<Batch[]> {
      const rows = await database.batches.orderBy('updatedAt').reverse().toArray()
      return rows.map((b) => BatchSchema.parse(b))
    },
    liveList: () => database.batches.orderBy('updatedAt').reverse().toArray(),
    async save(b: Batch): Promise<Batch> {
      const stamped = { ...b, updatedAt: new Date().toISOString() }
      const validated = BatchSchema.parse(stamped)
      await database.batches.put(validated)
      return validated
    },
    /**
     * ATOMIC delete + cascade: removes the batch AND tombstones any
     * `deviceLinks` row still pointed at it, in ONE transaction — mirrors
     * `inventoryRepo.delete()`'s item→ledger cascade (see `repos/inventory.ts`).
     * Without this, a deleted batch's stale link would keep resolving in the
     * sync daemon's `POST /readings` (see `reading-ingest.ts` /
     * `sync-server.ts`) — the daemon's own batch-existence check catches that
     * at ingest time too (belt-and-suspenders), but cascading the tombstone
     * here is what makes the link actually GO AWAY (and stay gone across a
     * sync merge — a surviving pre-delete copy on another device would
     * otherwise resurrect it) instead of dangling forever.
     */
    async delete(id: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction(
        'rw',
        database.batches,
        database.rowTombstones,
        database.deviceLinks,
        async () => {
          const cascadedLinks = await database.deviceLinks.where('batchId').equals(id).toArray()
          await database.batches.delete(id)
          await database.rowTombstones.put({ id, table: 'batches', deletedAt })
          if (cascadedLinks.length > 0) {
            await database.deviceLinks.bulkDelete(cascadedLinks.map((l) => l.id))
            await database.rowTombstones.bulkPut(
              cascadedLinks.map((l) => ({ id: l.id, table: 'deviceLinks', deletedAt })),
            )
          }
        },
      )
    },
    async getActive(): Promise<Batch | null> {
      // Indexed seek — `status` is in the batches index list. A bare .filter()
      // deserializes EVERY fat batch row (recipeSnapshot/process/logs) to find one.
      const row = await database.batches.where('status').equals('in-progress').first()
      return row ? BatchSchema.parse(row) : null
    },
    async getByBoard(boardId: NonNullable<Batch['fermenterBoardId']>): Promise<Batch | null> {
      // Seek the vessel via its index, then narrow by status across the handful of
      // batches that vessel has hosted — rather than scanning the whole table. The
      // old full scan walked rows in primary-key (UUID) order, so when duplicates
      // existed "which one wins" was effectively random.
      const row = await database.batches
        .where('fermenterBoardId')
        .equals(boardId)
        .filter((b) => b.status === 'in-progress')
        .first()
      return row ? BatchSchema.parse(row) : null
    },
    /**
     * ATOMIC get-or-create for a fermenter vessel — the ONLY safe way to mint a
     * batch from the guided runner.
     *
     * The runner used to check-then-act: `getByBoard()` → `await nextBatchNo()`
     * → `put()`, with no transaction spanning it. Two mounts (React StrictMode's
     * double-mount, a second tab, a remount after navigation) both read `null`
     * and both minted — duplicate in-progress batches on one vessel. The
     * component's `useRef` guard could never help: a ref is PER INSTANCE, so it
     * is null in every new mount.
     *
     * Re-checking, allocating batchNo, and putting inside ONE 'rw' transaction
     * closes it: IndexedDB serializes overlapping-scope readwrite transactions
     * per DATABASE (not per connection), so a second tab's transaction queues
     * behind this one and then sees the row. Allocating batchNo inside the tx
     * also fixes concurrent mints on DIFFERENT boards both claiming max+1.
     *
     * `make` MUST be synchronous — awaiting a non-Dexie promise inside a Dexie
     * transaction lets the transaction auto-close (TransactionInactiveError).
     *
     * Returns `created` so the caller can distinguish mint from rehydrate: the
     * guarded once-per-batch yeast deduction must fire on the mint path ONLY
     * (see the TOCTOU rationale in guided-runner's Effect 1).
     *
     * NOT covered: two devices minting offline on the same vessel — that is the
     * sync merge's job, deliberately, because a DB-level constraint here would
     * turn a survivable merge into a failed restore.
     */
    async getOrCreateForBoard(
      boardId: NonNullable<Batch['fermenterBoardId']>,
      make: (batchNo: number) => Batch,
    ): Promise<{ batch: Batch; created: boolean }> {
      return database.transaction('rw', database.batches, async () => {
        const existing = await database.batches
          .where('fermenterBoardId')
          .equals(boardId)
          .filter((b) => b.status === 'in-progress')
          .first()
        if (existing) return { batch: BatchSchema.parse(existing), created: false }

        const last = await database.batches.orderBy('batchNo').last()
        const next = BatchSchema.parse(make((last?.batchNo ?? 0) + 1))
        await database.batches.put(next)
        return { batch: next, created: true }
      })
    },
    // Collision-proof: recompute max(batchNo) at call time so two saves in a row
    // never reuse a number. A cached counter would collide after a restore/import.
    // NOTE: only safe for single mints — concurrent callers race. The runner uses
    // getOrCreateForBoard(), which allocates inside the transaction instead.
    async nextBatchNo(): Promise<number> {
      const last = await database.batches.orderBy('batchNo').last()
      return (last?.batchNo ?? 0) + 1
    },
  }
}

export const batchRepo = makeBatchRepo(db)
