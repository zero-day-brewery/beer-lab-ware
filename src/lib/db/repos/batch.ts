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
    async delete(id: string): Promise<void> {
      await database.batches.delete(id)
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
