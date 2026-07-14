import { type InventoryItem, InventoryItemSchema } from '@/lib/brewing/types/inventory'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeInventoryRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<InventoryItem | null> {
      const row = await database.inventoryItems.get(id)
      return row ? InventoryItemSchema.parse(row) : null
    },
    async list(): Promise<InventoryItem[]> {
      const rows = await database.inventoryItems.orderBy('updatedAt').reverse().toArray()
      return rows.map((r) => InventoryItemSchema.parse(r))
    },
    async listByKind(kind: InventoryItem['ingredientKind']): Promise<InventoryItem[]> {
      const rows = await database.inventoryItems.where('ingredientKind').equals(kind).sortBy('name')
      return rows.map((r) => InventoryItemSchema.parse(r))
    },
    async save(item: InventoryItem): Promise<InventoryItem> {
      const stamped = { ...item, updatedAt: new Date().toISOString() }
      const validated = InventoryItemSchema.parse(stamped)
      await database.inventoryItems.put(validated)
      return validated
    },
    async delete(id: string): Promise<void> {
      await database.inventoryItems.delete(id)
      // Tombstone so the seeder won't resurrect a deleted seed item on relaunch.
      await database.seedTombstones.put({ id })
    },
  }
}

export const inventoryRepo = makeInventoryRepo(db)
