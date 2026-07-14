import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { RecipeUseRef, StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { BrewDB } from '@/lib/db/schema'

const GRAIN_ID = '550e8400-e29b-41d4-a716-446655440020'
const HOP_ID = '550e8400-e29b-41d4-a716-446655440021'
const BATCH_A = '550e8400-e29b-41d4-a716-4466554400aa'
const BATCH_B = '550e8400-e29b-41d4-a716-4466554400bb'

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: GRAIN_ID,
    name: '2-Row Pale',
    ingredientKind: 'fermentable',
    amount: 5000,
    amountUnit: 'g',
    status: 'sealed',
    notes_md: '',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

const sumDeltas = (rows: StockTransaction[]) => rows.reduce((s, r) => s + r.delta, 0)

const ref: RecipeUseRef = {
  ingredientId: 'f0000000-0000-4000-8000-000000000001',
  line: 'fermentable',
}

/** Mirrors the review component's per-batch idempotency guard. */
async function deductOnce(
  repo: ReturnType<typeof makeStockTransactionsRepo>,
  batchId: string,
  inventoryItemId: string,
  draw: number,
): Promise<{ blocked: boolean; balance: number | null }> {
  const existing = await repo.listByBatch(batchId)
  if (existing.some((t) => t.reason === 'brew-deduct')) return { blocked: true, balance: null }
  const balance = await repo.applyStockChange({
    inventoryItemId,
    delta: -draw,
    reason: 'brew-deduct',
    batchId,
    recipeUseRef: ref,
  })
  return { blocked: false, balance }
}

describe('stockTransactionsRepo — brew-deduct (2b)', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeStockTransactionsRepo>

  beforeEach(async () => {
    db = new BrewDB('test-brew-deduct')
    await db.open()
    repo = makeStockTransactionsRepo(db)
    await db.inventoryItems.put(item({ id: GRAIN_ID, amount: 5000, amountUnit: 'g' }))
    await db.inventoryItems.put(
      item({ id: HOP_ID, name: 'Cascade', ingredientKind: 'hop', amount: 100, amountUnit: 'g' }),
    )
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-brew-deduct')
  })

  it('consume decrements the right item + persists batchId/recipeUseRef, invariant holds', async () => {
    const balance = await repo.applyStockChange({
      inventoryItemId: GRAIN_ID,
      delta: -3000,
      reason: 'brew-deduct',
      batchId: BATCH_A,
      recipeUseRef: ref,
    })
    expect(balance).toBe(2000)
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(2000)
    // The other item is untouched.
    expect((await db.inventoryItems.get(HOP_ID))?.amount).toBe(100)

    const rows = await repo.listByItem(GRAIN_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('brew-deduct')
    expect(rows[0].batchId).toBe(BATCH_A)
    expect(rows[0].recipeUseRef).toEqual(ref)
    expect(rows[0].delta).toBe(-3000)
    expect(sumDeltas(rows)).toBe(-3000) // amount(2000) === opening(0) + Σ deltas here (no opening seeded)
  })

  it('short consume clamps the item at 0 and records the effective delta', async () => {
    await db.inventoryItems.put(item({ id: GRAIN_ID, amount: 2000, amountUnit: 'g' }))
    const balance = await repo.applyStockChange({
      inventoryItemId: GRAIN_ID,
      delta: -5000, // would be −3000; clamps to 0
      reason: 'brew-deduct',
      batchId: BATCH_A,
      recipeUseRef: ref,
    })
    expect(balance).toBe(0)
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(0)
    expect((await repo.listByItem(GRAIN_ID)).at(-1)?.delta).toBe(-2000) // effective, not −5000
  })

  it('listByBatch returns only that batch, Zod-parsed', async () => {
    await repo.applyStockChange({
      inventoryItemId: GRAIN_ID,
      delta: -1000,
      reason: 'brew-deduct',
      batchId: BATCH_A,
      recipeUseRef: ref,
    })
    await repo.applyStockChange({
      inventoryItemId: HOP_ID,
      delta: -10,
      reason: 'brew-deduct',
      batchId: BATCH_A,
      recipeUseRef: ref,
    })
    await repo.applyStockChange({
      inventoryItemId: GRAIN_ID,
      delta: -500,
      reason: 'brew-deduct',
      batchId: BATCH_B,
      recipeUseRef: ref,
    })
    expect(await repo.listByBatch(BATCH_A)).toHaveLength(2)
    expect(await repo.listByBatch(BATCH_B)).toHaveLength(1)
    expect((await repo.listByBatch(BATCH_A)).every((t) => t.batchId === BATCH_A)).toBe(true)
  })

  it('idempotency: a second deduction on a batch with existing brew-deduct txns is blocked', async () => {
    const first = await deductOnce(repo, BATCH_A, GRAIN_ID, 1500)
    expect(first.blocked).toBe(false)
    expect(first.balance).toBe(3500)

    const second = await deductOnce(repo, BATCH_A, GRAIN_ID, 1500)
    expect(second.blocked).toBe(true)

    // Stock was decremented exactly once.
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(3500)
    expect(await repo.listByBatch(BATCH_A)).toHaveLength(1)
  })

  it('idempotency is per-batch: a different batch is not blocked', async () => {
    await deductOnce(repo, BATCH_A, GRAIN_ID, 1000)
    const other = await deductOnce(repo, BATCH_B, GRAIN_ID, 1000)
    expect(other.blocked).toBe(false)
    expect((await db.inventoryItems.get(GRAIN_ID))?.amount).toBe(3000)
  })
})
