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
      const row = await database.batches.filter((b) => b.status === 'in-progress').first()
      return row ? BatchSchema.parse(row) : null
    },
    async getByBoard(boardId: NonNullable<Batch['fermenterBoardId']>): Promise<Batch | null> {
      const row = await database.batches
        .filter((b) => b.status === 'in-progress' && b.fermenterBoardId === boardId)
        .first()
      return row ? BatchSchema.parse(row) : null
    },
    // Collision-proof: recompute max(batchNo) at call time so two saves in a row
    // never reuse a number. A cached counter would collide after a restore/import.
    async nextBatchNo(): Promise<number> {
      const last = await database.batches.orderBy('batchNo').last()
      return (last?.batchNo ?? 0) + 1
    },
  }
}

export const batchRepo = makeBatchRepo(db)
