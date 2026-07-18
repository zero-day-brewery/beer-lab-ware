import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { StockTransactionSchema } from '@/lib/brewing/types/stock-transaction'
import { BrewDB } from '@/lib/db/schema'

const DB_NAME = 'test-ledger-migration'

/**
 * Stand up a legacy (pre-v7) database that has NO stockTransactions store, seed
 * an inventory item, then close it. Opening `BrewDB` (which declares v7) against
 * the same IndexedDB name triggers the v7 `.upgrade` backfill.
 */
async function seedLegacyDb(items: Array<Record<string, unknown>>): Promise<void> {
  const legacy = new Dexie(DB_NAME)
  // Single consolidated v6 schema (mirrors BrewDB versions 1–6's final shape).
  legacy.version(6).stores({
    recipes: 'id, name, type, styleId, updatedAt',
    equipmentProfiles: 'id, name, isDefault',
    ingredients: 'id, name, kind, [kind+name]',
    settings: 'id',
    inventoryItems: 'id, ingredientKind, name, status, updatedAt',
    gearItems: 'id, category, name, condition, updatedAt',
    seedTombstones: 'id',
    waterProfiles: 'id, name',
    brewSessions: 'id, recipeId, status, stageId, startedAt, updatedAt',
    brewTimers: 'id, sessionId, stepId, status, fireAt',
    batches: 'id, status, batchNo, recipeId, fermenterBoardId, updatedAt, brewedAt',
    readings: 'id, batchId, at, [batchId+at]',
  })
  await legacy.open()
  await legacy.table('inventoryItems').bulkPut(items)
  legacy.close()
}

const legacyItem = (over: Record<string, unknown> = {}) => ({
  id: '550e8400-e29b-41d4-a716-4466554400a1',
  name: 'Maris Otter',
  ingredientKind: 'fermentable',
  amount: 5,
  amountUnit: 'kg',
  status: 'sealed',
  notes_md: '',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
  schemaVersion: 1,
  ...over,
})

describe('v7 stock-ledger migration (opening-balance backfill)', () => {
  afterEach(async () => {
    await BrewDB.delete(DB_NAME)
  })

  it('opens a pre-v7 DB at v7 and leaves the existing pantry row intact', async () => {
    await seedLegacyDb([legacyItem()])
    const db = new BrewDB(DB_NAME)
    await db.open()
    expect(db.verno).toBe(12)
    // The legacy row survives the additive upgrade (no data loss).
    expect(await db.inventoryItems.count()).toBe(1)
    const kept = await db.inventoryItems.get('550e8400-e29b-41d4-a716-4466554400a1')
    expect(kept?.name).toBe('Maris Otter')
    expect(kept?.amount).toBe(5)
    db.close()
  })

  it('backfills exactly one opening txn per item, delta = amount, at = updatedAt', async () => {
    await seedLegacyDb([legacyItem()])
    const db = new BrewDB(DB_NAME)
    await db.open()

    const txns = await db.stockTransactions.toArray()
    expect(txns).toHaveLength(1)
    const opening = txns[0]
    // Migration produced a schema-valid row.
    expect(() => StockTransactionSchema.parse(opening)).not.toThrow()
    expect(opening.reason).toBe('opening')
    expect(opening.inventoryItemId).toBe('550e8400-e29b-41d4-a716-4466554400a1')
    expect(opening.delta).toBe(5)
    expect(opening.unit).toBe('kg')
    expect(opening.kind).toBe('fermentable')
    expect(opening.at).toBe('2026-06-20T00:00:00.000Z')
    db.close()
  })

  it('holds the invariant amount === Σ deltas after the backfill (multiple items)', async () => {
    await seedLegacyDb([
      legacyItem({ id: '550e8400-e29b-41d4-a716-4466554400a1', amount: 5, amountUnit: 'kg' }),
      legacyItem({
        id: '550e8400-e29b-41d4-a716-4466554400b2',
        name: 'Cascade',
        ingredientKind: 'hop',
        amount: 227,
        amountUnit: 'g',
      }),
    ])
    const db = new BrewDB(DB_NAME)
    await db.open()

    expect(await db.stockTransactions.count()).toBe(2)
    for (const it of await db.inventoryItems.toArray()) {
      const rows = await db.stockTransactions.where('inventoryItemId').equals(it.id).toArray()
      const sum = rows.reduce((s, r) => s + r.delta, 0)
      expect(sum).toBe(it.amount)
    }
    db.close()
  })

  it('creates an empty ledger when there is no pantry to backfill', async () => {
    await seedLegacyDb([])
    const db = new BrewDB(DB_NAME)
    await db.open()
    expect(db.verno).toBe(12)
    expect(await db.stockTransactions.count()).toBe(0)
    db.close()
  })
})
