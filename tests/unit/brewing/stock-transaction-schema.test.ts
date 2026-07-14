import { describe, expect, it } from 'vitest'
import {
  buildStockTransaction,
  runningBalances,
  StockReasonSchema,
  StockTransactionSchema,
} from '@/lib/brewing/types/stock-transaction'

const ITEM_ID = '550e8400-e29b-41d4-a716-446655440020'
const TXN_ID = '11111111-1111-4111-8111-111111111111'

describe('StockTransactionSchema', () => {
  it('round-trips a valid opening transaction', () => {
    const txn = {
      id: TXN_ID,
      inventoryItemId: ITEM_ID,
      kind: 'hop' as const,
      delta: 227,
      unit: 'g' as const,
      reason: 'opening' as const,
      at: '2026-07-05T00:00:00.000Z',
      schemaVersion: 1 as const,
    }
    expect(StockTransactionSchema.parse(txn)).toEqual(txn)
  })

  it('accepts the 2b-reserved fields (batchId, recipeUseRef, brew-deduct)', () => {
    const parsed = StockTransactionSchema.parse({
      id: TXN_ID,
      inventoryItemId: ITEM_ID,
      kind: 'fermentable',
      delta: -2.5,
      unit: 'kg',
      reason: 'brew-deduct',
      batchId: '22222222-2222-4222-8222-222222222222',
      recipeUseRef: { ingredientId: 'ferm-1', line: 'fermentable' },
      at: '2026-07-05T00:00:00.000Z',
      schemaVersion: 1,
    })
    expect(parsed.reason).toBe('brew-deduct')
    expect(parsed.batchId).toBe('22222222-2222-4222-8222-222222222222')
    expect(parsed.recipeUseRef?.line).toBe('fermentable')
  })

  it('rejects a non-uuid id', () => {
    expect(() =>
      StockTransactionSchema.parse({
        id: 'not-a-uuid',
        inventoryItemId: ITEM_ID,
        kind: 'hop',
        delta: 1,
        unit: 'g',
        reason: 'restock',
        at: '2026-07-05T00:00:00.000Z',
        schemaVersion: 1,
      }),
    ).toThrow()
  })

  it('rejects an unknown reason', () => {
    expect(StockReasonSchema.safeParse('bogus').success).toBe(false)
    expect(StockReasonSchema.safeParse('opening').success).toBe(true)
  })
})

describe('buildStockTransaction', () => {
  it('maps item fields + signed delta into a schema-valid txn', () => {
    const txn = buildStockTransaction({
      id: TXN_ID,
      item: { id: ITEM_ID, ingredientKind: 'hop', amountUnit: 'g' },
      delta: -50,
      reason: 'spoilage',
      at: '2026-07-05T00:00:00.000Z',
      note: 'moldy',
    })
    expect(() => StockTransactionSchema.parse(txn)).not.toThrow()
    expect(txn.inventoryItemId).toBe(ITEM_ID)
    expect(txn.kind).toBe('hop')
    expect(txn.unit).toBe('g')
    expect(txn.delta).toBe(-50)
    expect(txn.note).toBe('moldy')
    expect(txn.schemaVersion).toBe(1)
  })

  it('omits optional keys when not supplied', () => {
    const txn = buildStockTransaction({
      id: TXN_ID,
      item: { id: ITEM_ID, ingredientKind: 'misc', amountUnit: 'each' },
      delta: 1,
      reason: 'restock',
      at: '2026-07-05T00:00:00.000Z',
    })
    expect('note' in txn).toBe(false)
    expect('batchId' in txn).toBe(false)
    expect('recipeUseRef' in txn).toBe(false)
  })
})

describe('runningBalances', () => {
  it('accumulates signed deltas chronologically', () => {
    expect(runningBalances([{ delta: 100 }, { delta: -30 }, { delta: 5 }])).toEqual([100, 70, 75])
  })

  it('returns an empty array for no transactions', () => {
    expect(runningBalances([])).toEqual([])
  })

  it('final balance equals the signed sum of all deltas', () => {
    const deltas = [{ delta: 10 }, { delta: 2.5 }, { delta: -4 }, { delta: 1.5 }]
    const balances = runningBalances(deltas)
    expect(balances.at(-1)).toBe(deltas.reduce((s, d) => s + d.delta, 0))
  })
})
