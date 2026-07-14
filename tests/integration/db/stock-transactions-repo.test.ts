import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import {
  buildStockTransaction,
  type StockReason,
  type StockTransaction,
} from '@/lib/brewing/types/stock-transaction'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { BrewDB } from '@/lib/db/schema'
import { newId } from '@/lib/utils/id'

const ITEM_ID = '550e8400-e29b-41d4-a716-446655440020'
const OTHER_ID = '550e8400-e29b-41d4-a716-4466554400ff'

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: ITEM_ID,
    name: 'Cascade pellets',
    ingredientKind: 'hop',
    amount: 100,
    amountUnit: 'g',
    status: 'sealed',
    notes_md: '',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function txn(
  at: string,
  delta: number,
  reason: StockReason = 'restock',
  id = ITEM_ID,
): StockTransaction {
  return buildStockTransaction({
    id: newId(),
    item: { id, ingredientKind: 'hop', amountUnit: 'g' },
    delta,
    reason,
    at,
  })
}

const sumDeltas = (rows: StockTransaction[]) => rows.reduce((s, r) => s + r.delta, 0)

describe('stockTransactionsRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeStockTransactionsRepo>

  beforeEach(async () => {
    db = new BrewDB('test-stock-txn')
    await db.open()
    repo = makeStockTransactionsRepo(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-stock-txn')
  })

  it('append persists + listByItem round-trips through Zod', async () => {
    await repo.append(txn('2026-07-05T00:00:00.000Z', 227, 'opening'))
    const rows = await repo.listByItem(ITEM_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0].delta).toBe(227)
    expect(rows[0].reason).toBe('opening')
    expect(rows[0].schemaVersion).toBe(1)
  })

  it('listByItem returns transactions chronological (oldest → newest)', async () => {
    await repo.append(txn('2026-07-07T00:00:00.000Z', 3))
    await repo.append(txn('2026-07-05T00:00:00.000Z', 1))
    await repo.append(txn('2026-07-06T00:00:00.000Z', 2))
    const rows = await repo.listByItem(ITEM_ID)
    expect(rows.map((r) => r.at)).toEqual([
      '2026-07-05T00:00:00.000Z',
      '2026-07-06T00:00:00.000Z',
      '2026-07-07T00:00:00.000Z',
    ])
  })

  it('listByItem scopes to a single item (compound index)', async () => {
    await repo.append(txn('2026-07-05T00:00:00.000Z', 1))
    await repo.append(txn('2026-07-05T00:00:00.000Z', 9, 'restock', OTHER_ID))
    expect(await repo.listByItem(ITEM_ID)).toHaveLength(1)
    expect(await repo.listByItem(OTHER_ID)).toHaveLength(1)
  })

  it('applyStockChange writes the txn AND updates the cached amount atomically', async () => {
    await db.inventoryItems.put(item({ amount: 100 }))
    const balance = await repo.applyStockChange({
      inventoryItemId: ITEM_ID,
      delta: 50,
      reason: 'restock',
    })
    expect(balance).toBe(150)
    expect((await db.inventoryItems.get(ITEM_ID))?.amount).toBe(150)
    const rows = await repo.listByItem(ITEM_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0].delta).toBe(50)
    expect(rows[0].reason).toBe('restock')
    expect(rows[0].unit).toBe('g')
    expect(rows[0].kind).toBe('hop')
  })

  it('applyStockChange handles a negative delta (deduct) and returns the new balance', async () => {
    await db.inventoryItems.put(item({ amount: 100 }))
    const balance = await repo.applyStockChange({
      inventoryItemId: ITEM_ID,
      delta: -30,
      reason: 'spoilage',
    })
    expect(balance).toBe(70)
    expect((await db.inventoryItems.get(ITEM_ID))?.amount).toBe(70)
    expect((await repo.listByItem(ITEM_ID))[0].delta).toBe(-30)
  })

  it('applyStockChange clamps the amount at 0 and records the EFFECTIVE delta (invariant holds)', async () => {
    await db.inventoryItems.put(item({ amount: 5 }))
    // Opening txn so the item starts consistent (amount === Σ deltas).
    await repo.append(txn('2026-07-04T00:00:00.000Z', 5, 'opening'))
    const balance = await repo.applyStockChange({
      inventoryItemId: ITEM_ID,
      delta: -10, // would go to -5; must clamp to 0
      reason: 'spoilage',
    })
    expect(balance).toBe(0)
    expect((await db.inventoryItems.get(ITEM_ID))?.amount).toBe(0)
    const rows = await repo.listByItem(ITEM_ID)
    // Effective delta recorded is -5 (not -10) so amount === Σ deltas survives the clamp.
    expect(rows.at(-1)?.delta).toBe(-5)
    expect(sumDeltas(rows)).toBe(0)
  })

  it('applyStockChange throws when the item does not exist (writes nothing)', async () => {
    await expect(
      repo.applyStockChange({
        inventoryItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        delta: 1,
        reason: 'restock',
      }),
    ).rejects.toThrow()
    expect(await db.stockTransactions.count()).toBe(0)
  })

  it('applyStockChange stamps the item updatedAt to the txn time', async () => {
    await db.inventoryItems.put(item({ amount: 100, updatedAt: '2020-01-01T00:00:00.000Z' }))
    await repo.applyStockChange({
      inventoryItemId: ITEM_ID,
      delta: 1,
      reason: 'restock',
      at: '2026-07-05T09:00:00.000Z',
    })
    const updated = await db.inventoryItems.get(ITEM_ID)
    expect(updated?.updatedAt).toBe('2026-07-05T09:00:00.000Z')
  })

  it('deleteByItem cascades every txn for that item only', async () => {
    await repo.append(txn('2026-07-05T00:00:00.000Z', 1))
    await repo.append(txn('2026-07-06T00:00:00.000Z', 2))
    await repo.append(txn('2026-07-05T00:00:00.000Z', 9, 'restock', OTHER_ID))
    await repo.deleteByItem(ITEM_ID)
    expect(await repo.listByItem(ITEM_ID)).toHaveLength(0)
    expect(await repo.listByItem(OTHER_ID)).toHaveLength(1)
  })

  it('append rejects a row that fails Zod (bad uuid)', async () => {
    await expect(
      repo.append({ ...txn('2026-07-05T00:00:00.000Z', 1), id: 'not-a-uuid' } as StockTransaction),
    ).rejects.toThrow()
    expect(await db.stockTransactions.count()).toBe(0)
  })
})
