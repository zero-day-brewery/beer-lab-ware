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
    /**
     * ATOMIC delete + cascade: removes the item AND every one of its ledger
     * rows (stockTransactions) in ONE transaction, tombstoning all of them —
     * a crash between the item delete and the ledger cascade (or between
     * either delete and its tombstone) can never happen. Without cascading
     * the tombstones too, a deleted item would resurrect via its own
     * surviving ledger rows through `mergeLedger` (see sync/merge.ts) even
     * though the item itself was correctly suppressed.
     */
    async delete(id: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction(
        'rw',
        database.inventoryItems,
        database.seedTombstones,
        database.rowTombstones,
        database.stockTransactions,
        async () => {
          const cascaded = await database.stockTransactions
            .where('inventoryItemId')
            .equals(id)
            .toArray()
          await database.inventoryItems.delete(id)
          // Tombstone so the seeder won't resurrect a deleted seed item on relaunch.
          await database.seedTombstones.put({ id })
          await database.rowTombstones.put({ id, table: 'inventoryItems', deletedAt })
          if (cascaded.length > 0) {
            await database.stockTransactions.bulkDelete(cascaded.map((t) => t.id))
            await database.rowTombstones.bulkPut(
              cascaded.map((t) => ({ id: t.id, table: 'stockTransactions', deletedAt })),
            )
          }
        },
      )
    },
  }
}

export const inventoryRepo = makeInventoryRepo(db)
