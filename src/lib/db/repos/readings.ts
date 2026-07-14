import type { Reading } from '@/lib/brewing/types/reading'
import { ReadingSchema } from '@/lib/brewing/types/reading'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeReadingsRepo(database: BrewDB) {
  return {
    async create(r: Reading): Promise<Reading> {
      const validated = ReadingSchema.parse(r)
      await database.readings.put(validated)
      return validated
    },
    async listByBatch(batchId: string): Promise<Reading[]> {
      const rows = await database.readings.where('batchId').equals(batchId).sortBy('at')
      return rows.map((r) => ReadingSchema.parse(r))
    },
    async delete(id: string): Promise<void> {
      await database.readings.delete(id)
    },
  }
}

export const readingsRepo = makeReadingsRepo(db)
