import { type Water, WaterSchema } from '@/lib/brewing/types/ingredient'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeWaterRepo(database: BrewDB) {
  return {
    async list(): Promise<Water[]> {
      const rows = await database.waterProfiles.orderBy('name').toArray()
      return rows.map((r) => WaterSchema.parse(r))
    },
    async get(id: string): Promise<Water | null> {
      const row = await database.waterProfiles.get(id)
      return row ? WaterSchema.parse(row) : null
    },
    async save(p: Water): Promise<Water> {
      const validated = WaterSchema.parse(p)
      await database.waterProfiles.put(validated)
      return validated
    },
    async delete(id: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction('rw', database.waterProfiles, database.rowTombstones, async () => {
        await database.waterProfiles.delete(id)
        await database.rowTombstones.put({ id, table: 'waterProfiles', deletedAt })
      })
    },
  }
}

export const waterRepo = makeWaterRepo(db)
