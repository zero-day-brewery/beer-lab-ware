import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import {
  buildStockTransaction,
  type RecipeUseRef,
  type StockReason,
  type StockTransaction,
} from '@/lib/brewing/types/stock-transaction'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { BrewDB } from '@/lib/db/schema'
import { newId } from '@/lib/utils/id'

const ITEM_ID = '550e8400-e29b-41d4-a716-446655440020'
const GRAIN_ID = '550e8400-e29b-41d4-a716-446655440021'
const HOP_ID = '550e8400-e29b-41d4-a716-446655440022'
const MISSING_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const BATCH_A = '550e8400-e29b-41d4-a716-4466554400aa'
const BATCH_B = '550e8400-e29b-41d4-a716-4466554400bb'

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

function txnFor(
  it: Pick<InventoryItem, 'id' | 'ingredientKind' | 'amountUnit'>,
  delta: number,
  reason: StockReason = 'restock',
  at = '2026-07-05T00:00:00.000Z',
): StockTransaction {
  return buildStockTransaction({ id: newId(), item: it, delta, reason, at })
}

const ref: RecipeUseRef = {
  ingredientId: 'f0000000-0000-4000-8000-000000000001',
  line: 'fermentable',
}

const sumDeltas = (rows: StockTransaction[]) => rows.reduce((s, r) => s + r.delta, 0)

describe('stockTransactionsRepo.saveItemWithTxn (atomic new-item / edit-amount)', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeStockTransactionsRepo>

  beforeEach(async () => {
    db = new BrewDB('test-save-item-with-txn')
    await db.open()
    repo = makeStockTransactionsRepo(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-save-item-with-txn')
  })

  it('persists BOTH the item and its ledger txn (new item → restock)', async () => {
    const it = item({ amount: 454 })
    await repo.saveItemWithTxn(it, txnFor(it, 454, 'restock'))

    expect((await db.inventoryItems.get(ITEM_ID))?.amount).toBe(454)
    const rows = await repo.listByItem(ITEM_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('restock')
    expect(rows[0].delta).toBe(454)
    // invariant: amount === Σ deltas
    expect(sumDeltas(rows)).toBe(454)
  })

  it('a null txn writes only the item (non-amount edit — no ledger row)', async () => {
    await db.inventoryItems.put(item({ amount: 100 }))
    await repo.saveItemWithTxn(item({ amount: 100, vendor: 'Yakima' }), null)
    expect((await db.inventoryItems.get(ITEM_ID))?.vendor).toBe('Yakima')
    expect(await repo.listByItem(ITEM_ID)).toHaveLength(0)
  })

  it('a forced-invalid txn rolls BOTH stores back (item unchanged, no txn)', async () => {
    // Seed a consistent starting state: amount 100 + matching opening txn.
    await db.inventoryItems.put(item({ amount: 100 }))
    const seedTxn = txnFor(item(), 100, 'opening', '2026-07-04T00:00:00.000Z')
    await repo.append(seedTxn)

    // Attempt an edit to 150 with a txn that fails Zod (bad uuid). The item put
    // happens FIRST inside the tx, then the txn parse throws → whole tx aborts.
    const badTxn = { ...txnFor(item(), 50, 'manual-adjust'), id: 'not-a-uuid' } as StockTransaction
    await expect(repo.saveItemWithTxn(item({ amount: 150 }), badTxn)).rejects.toThrow()

    // Rolled back: amount stays 100, no manual-adjust row landed.
    expect((await db.inventoryItems.get(ITEM_ID))?.amount).toBe(100)
    const rows = await repo.listByItem(ITEM_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('opening')
    expect(sumDeltas(rows)).toBe(100) // invariant intact after the failed edit
  })

  it('invariant amount === Σ deltas holds across an add then an edit', async () => {
    // Add.
    const created = item({ amount: 200 })
    await repo.saveItemWithTxn(created, txnFor(created, 200, 'restock'))
    // Edit +50.
    const edited = item({ amount: 250 })
    await repo.saveItemWithTxn(edited, txnFor(edited, 50, 'manual-adjust'))

    const rows = await repo.listByItem(ITEM_ID)
    expect((await db.inventoryItems.get(ITEM_ID))?.amount).toBe(250)
    expect(sumDeltas(rows)).toBe(250)
  })
})

describe('stockTransactionsRepo.applyStockChanges (atomic 2b batch-deduct)', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeStockTransactionsRepo>

  beforeEach(async () => {
    db = new BrewDB('test-apply-stock-changes')
    await db.open()
    repo = makeStockTransactionsRepo(db)
    await db.inventoryItems.put(
      item({ id: GRAIN_ID, name: '2-Row', ingredientKind: 'fermentable', amount: 5000 }),
    )
    await db.inventoryItems.put(
      item({ id: HOP_ID, name: 'Cascade', ingredientKind: 'hop', amount: 100 }),
    )
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-apply-stock-changes')
  })

  it('applies every change atomically (amounts + txns), invariant per item', async () => {
    await repo.applyStockChanges(
      [
        {
          inventoryItemId: GRAIN_ID,
          delta: -3000,
          reason: 'brew-deduct',
          batchId: BATCH_A,
          recipeUseRef: ref,
        },
        {
          inventoryItemId: HOP_ID,
          delta: -10,
          reason: 'brew-deduct',
          batchId: BATCH_A,
          recipeUseRef: ref,
        },
      ],
      { batchId: BATCH_A },
    )

    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(2000)
    expect((await db.inventoryItems.get(HOP_ID))?.amount).toBe(90)

    const batchRows = await repo.listByBatch(BATCH_A)
    expect(batchRows).toHaveLength(2)
    expect(batchRows.every((t) => t.reason === 'brew-deduct')).toBe(true)
    expect(batchRows.every((t) => t.batchId === BATCH_A)).toBe(true)
    expect(batchRows.every((t) => t.recipeUseRef !== undefined)).toBe(true)
  })

  it('chains read-modify-write for two changes on the SAME item within one tx', async () => {
    await repo.applyStockChanges(
      [
        {
          inventoryItemId: GRAIN_ID,
          delta: -1000,
          reason: 'brew-deduct',
          batchId: BATCH_A,
          recipeUseRef: ref,
        },
        {
          inventoryItemId: GRAIN_ID,
          delta: -500,
          reason: 'brew-deduct',
          batchId: BATCH_A,
          recipeUseRef: ref,
        },
      ],
      { batchId: BATCH_A },
    )
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(3500)
    expect(await repo.listByBatch(BATCH_A)).toHaveLength(2)
  })

  it('the per-batch guard aborts a SECOND call for the same batchId (idempotent)', async () => {
    await repo.applyStockChanges(
      [
        {
          inventoryItemId: GRAIN_ID,
          delta: -1500,
          reason: 'brew-deduct',
          batchId: BATCH_A,
          recipeUseRef: ref,
        },
      ],
      { batchId: BATCH_A },
    )
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(3500)

    // Second call for the same batch throws and writes nothing more.
    await expect(
      repo.applyStockChanges(
        [
          {
            inventoryItemId: GRAIN_ID,
            delta: -1500,
            reason: 'brew-deduct',
            batchId: BATCH_A,
            recipeUseRef: ref,
          },
        ],
        { batchId: BATCH_A },
      ),
    ).rejects.toThrow(/already deducted/)

    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(3500) // unchanged
    expect(await repo.listByBatch(BATCH_A)).toHaveLength(1) // still exactly one
  })

  it('guard is per-batch — a different batchId is not blocked', async () => {
    await repo.applyStockChanges(
      [
        {
          inventoryItemId: GRAIN_ID,
          delta: -1000,
          reason: 'brew-deduct',
          batchId: BATCH_A,
          recipeUseRef: ref,
        },
      ],
      { batchId: BATCH_A },
    )
    await repo.applyStockChanges(
      [
        {
          inventoryItemId: GRAIN_ID,
          delta: -1000,
          reason: 'brew-deduct',
          batchId: BATCH_B,
          recipeUseRef: ref,
        },
      ],
      { batchId: BATCH_B },
    )
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(3000)
    expect(await repo.listByBatch(BATCH_A)).toHaveLength(1)
    expect(await repo.listByBatch(BATCH_B)).toHaveLength(1)
  })

  it('a mid-array invalid change rolls ALL changes back (no partial deduction)', async () => {
    await expect(
      repo.applyStockChanges(
        [
          // valid — would drop GRAIN to 4000
          {
            inventoryItemId: GRAIN_ID,
            delta: -1000,
            reason: 'brew-deduct',
            batchId: BATCH_B,
            recipeUseRef: ref,
          },
          // invalid — item does not exist → throws mid-batch
          {
            inventoryItemId: MISSING_ID,
            delta: -10,
            reason: 'brew-deduct',
            batchId: BATCH_B,
            recipeUseRef: ref,
          },
        ],
        { batchId: BATCH_B },
      ),
    ).rejects.toThrow(/not found/)

    // Nothing committed: GRAIN untouched, no txns for the batch.
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(5000)
    expect(await repo.listByBatch(BATCH_B)).toHaveLength(0)
  })

  it('a short change clamps the item at 0 and records the EFFECTIVE delta', async () => {
    await db.inventoryItems.put(
      item({ id: GRAIN_ID, name: '2-Row', ingredientKind: 'fermentable', amount: 2000 }),
    )
    await repo.applyStockChanges(
      [
        {
          inventoryItemId: GRAIN_ID,
          delta: -5000,
          reason: 'brew-deduct',
          batchId: BATCH_A,
          recipeUseRef: ref,
        },
      ],
      { batchId: BATCH_A },
    )
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(0)
    expect((await repo.listByBatch(BATCH_A)).at(0)?.delta).toBe(-2000) // effective, not −5000
  })
})
