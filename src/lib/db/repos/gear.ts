import { type GearItem, GearItemSchema } from '@/lib/brewing/types/gear'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeGearRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<GearItem | null> {
      const row = await database.gearItems.get(id)
      return row ? GearItemSchema.parse(row) : null
    },
    async list(): Promise<GearItem[]> {
      const rows = await database.gearItems.orderBy('updatedAt').reverse().toArray()
      return rows.map((r) => GearItemSchema.parse(r))
    },
    async listByCategory(category: GearItem['category']): Promise<GearItem[]> {
      const rows = await database.gearItems.where('category').equals(category).sortBy('name')
      return rows.map((r) => GearItemSchema.parse(r))
    },
    async save(item: GearItem): Promise<GearItem> {
      const stamped = { ...item, updatedAt: new Date().toISOString() }
      const validated = GearItemSchema.parse(stamped)
      await database.gearItems.put(validated)
      return validated
    },
    async delete(id: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction(
        'rw',
        database.gearItems,
        database.seedTombstones,
        database.rowTombstones,
        async () => {
          await database.gearItems.delete(id)
          // Tombstone so the seeder won't resurrect a deleted seed item on relaunch.
          await database.seedTombstones.put({ id })
          await database.rowTombstones.put({ id, table: 'gearItems', deletedAt })
        },
      )
    },
  }
}

export const gearRepo = makeGearRepo(db)
