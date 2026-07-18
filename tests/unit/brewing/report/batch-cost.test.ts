import { describe, expect, it } from 'vitest'
import { computeBatchCost } from '@/lib/brewing/report/batch-cost'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'

const BATCH_ID = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-07-01T12:00:00.000Z'

function item(overrides: Partial<InventoryItem> & { id: string; name: string }): InventoryItem {
  return {
    ingredientKind: 'fermentable',
    amount: 10,
    amountUnit: 'kg',
    status: 'sealed',
    notes_md: '',
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: 1,
    ...overrides,
  }
}

let txnSeq = 0
function txn(
  overrides: Partial<StockTransaction> & { inventoryItemId: string; delta: number },
): StockTransaction {
  txnSeq += 1
  return {
    id: `00000000-0000-4000-8000-${String(txnSeq).padStart(12, '0')}`,
    kind: 'fermentable',
    unit: 'kg',
    reason: 'brew-deduct',
    batchId: BATCH_ID,
    at: NOW,
    schemaVersion: 1,
    ...overrides,
  }
}

/** Minimal batch shape the engine reads: results volume + recipe snapshot. */
function batch(overrides: Partial<Batch> = {}): Pick<Batch, 'results' | 'recipeSnapshot'> {
  return { results: {}, ...overrides }
}

const PALE = item({
  id: '11111111-0000-4000-8000-000000000001',
  name: 'Pale Malt',
  pricePerUnit_USD: 2.5,
})
const CASCADE = item({
  id: '11111111-0000-4000-8000-000000000002',
  name: 'Cascade',
  ingredientKind: 'hop',
  amountUnit: 'g',
  pricePerUnit_USD: 0.04,
})
const UNPRICED_YEAST = item({
  id: '11111111-0000-4000-8000-000000000003',
  name: 'US-05',
  ingredientKind: 'yeast',
  amountUnit: 'packets',
})

describe('computeBatchCost', () => {
  it('joins ledger consumption with item prices into costed lines + totals', () => {
    const report = computeBatchCost({
      batch: batch({ results: { intoFermenter_L: 20 } }),
      txns: [
        txn({ inventoryItemId: PALE.id, delta: -5 }),
        txn({ inventoryItemId: CASCADE.id, delta: -60, kind: 'hop', unit: 'g' }),
      ],
      items: [PALE, CASCADE],
    })

    expect(report.currency).toBe('USD')
    expect(report.lines).toEqual([
      {
        itemName: 'Pale Malt',
        kind: 'fermentable',
        qty: 5,
        unit: 'kg',
        unitPrice: 2.5,
        cost: 12.5,
      },
      { itemName: 'Cascade', kind: 'hop', qty: 60, unit: 'g', unitPrice: 0.04, cost: 2.4 },
    ])
    expect(report.knownCost).toBeCloseTo(14.9, 10)
    expect(report.unknownLines).toEqual([])
    expect(report.volume_L).toBe(20)
    expect(report.costPerLiter).toBeCloseTo(14.9 / 20, 10)
  })

  it('lists unpriced items but NEVER guesses — excluded from the total, surfaced in unknownLines', () => {
    const report = computeBatchCost({
      batch: batch({ results: { intoFermenter_L: 20 } }),
      txns: [
        txn({ inventoryItemId: PALE.id, delta: -4 }),
        txn({ inventoryItemId: UNPRICED_YEAST.id, delta: -1, kind: 'yeast', unit: 'packets' }),
      ],
      items: [PALE, UNPRICED_YEAST],
    })

    expect(report.lines).toHaveLength(2)
    const yeastLine = report.lines.find((l) => l.itemName === 'US-05')
    expect(yeastLine).toEqual({
      itemName: 'US-05',
      kind: 'yeast',
      qty: 1,
      unit: 'packets',
      unitPrice: null,
      cost: null,
    })
    expect(report.knownCost).toBeCloseTo(10, 10)
    expect(report.unknownLines).toEqual([yeastLine])
  })

  it('nets multiple txns per item — positive deltas (returns/adjustments) reduce cost', () => {
    const report = computeBatchCost({
      batch: batch({ results: { intoFermenter_L: 20 } }),
      txns: [
        txn({ inventoryItemId: PALE.id, delta: -5 }),
        txn({ inventoryItemId: PALE.id, delta: 1, reason: 'manual-adjust' }),
      ],
      items: [PALE],
    })

    expect(report.lines).toEqual([
      {
        itemName: 'Pale Malt',
        kind: 'fermentable',
        qty: 4,
        unit: 'kg',
        unitPrice: 2.5,
        cost: 10,
      },
    ])
    expect(report.knownCost).toBeCloseTo(10, 10)
  })

  it('EXCLUDES sync-reconcile txns — accounting corrections, not consumption', () => {
    const report = computeBatchCost({
      batch: batch({ results: { intoFermenter_L: 20 } }),
      txns: [
        txn({ inventoryItemId: PALE.id, delta: -5 }),
        txn({ inventoryItemId: PALE.id, delta: 3, reason: 'sync-reconcile' }),
      ],
      items: [PALE],
    })

    expect(report.lines[0]?.qty).toBe(5)
    expect(report.knownCost).toBeCloseTo(12.5, 10)
  })

  it('drops lines that net to zero (fully returned)', () => {
    const report = computeBatchCost({
      batch: batch(),
      txns: [
        txn({ inventoryItemId: PALE.id, delta: -5 }),
        txn({ inventoryItemId: PALE.id, delta: 5, reason: 'manual-adjust' }),
      ],
      items: [PALE],
    })
    expect(report.lines).toEqual([])
    expect(report.knownCost).toBe(0)
    expect(report.costPerLiter).toBeNull()
  })

  it('a net-negative line (return exceeds deduction) carries a negative cost that reduces the total', () => {
    const report = computeBatchCost({
      batch: batch({ results: { intoFermenter_L: 20 } }),
      txns: [
        txn({ inventoryItemId: PALE.id, delta: -4 }),
        txn({ inventoryItemId: CASCADE.id, delta: -50, kind: 'hop', unit: 'g' }),
        txn({ inventoryItemId: CASCADE.id, delta: 75, kind: 'hop', unit: 'g', reason: 'restock' }),
      ],
      items: [PALE, CASCADE],
    })

    const hop = report.lines.find((l) => l.itemName === 'Cascade')
    expect(hop?.qty).toBe(-25)
    expect(hop?.cost).toBeCloseTo(-1, 10)
    expect(report.knownCost).toBeCloseTo(10 - 1, 10)
  })

  it('deleted inventory items fall back to the recipe-snapshot name via recipeUseRef', () => {
    const recipeSnapshot = {
      hops: [
        {
          ingredientId: 'hop-1',
          snapshot: { name: 'Saaz (deleted from pantry)' },
        },
      ],
      fermentables: [],
      yeasts: [],
      miscs: [],
    } as unknown as Batch['recipeSnapshot']
    const report = computeBatchCost({
      batch: batch({ recipeSnapshot }),
      txns: [
        txn({
          inventoryItemId: '11111111-0000-4000-8000-00000000dead',
          delta: -30,
          kind: 'hop',
          unit: 'g',
          recipeUseRef: { ingredientId: 'hop-1', line: 'hop' },
        }),
      ],
      items: [],
    })

    expect(report.lines).toEqual([
      {
        itemName: 'Saaz (deleted from pantry)',
        kind: 'hop',
        qty: 30,
        unit: 'g',
        unitPrice: null,
        cost: null,
      },
    ])
    expect(report.unknownLines).toHaveLength(1)
  })

  it('deleted items without any recoverable context render as "deleted item"', () => {
    const report = computeBatchCost({
      batch: batch(),
      txns: [txn({ inventoryItemId: '11111111-0000-4000-8000-00000000dead', delta: -2 })],
      items: [],
    })
    expect(report.lines[0]?.itemName).toBe('deleted item')
    expect(report.lines[0]?.unitPrice).toBeNull()
  })

  it('uses the txn note as a deleted-item name before giving up', () => {
    const report = computeBatchCost({
      batch: batch(),
      txns: [
        txn({
          inventoryItemId: '11111111-0000-4000-8000-00000000dead',
          delta: -2,
          note: 'Maris Otter',
        }),
      ],
      items: [],
    })
    expect(report.lines[0]?.itemName).toBe('Maris Otter')
  })

  it('costPerLiter falls back to the recipe batch size when no measured into-fermenter volume', () => {
    const recipeSnapshot = { batchSize_L: 19 } as unknown as Batch['recipeSnapshot']
    const report = computeBatchCost({
      batch: batch({ recipeSnapshot }),
      txns: [txn({ inventoryItemId: PALE.id, delta: -5 })],
      items: [PALE],
    })
    expect(report.volume_L).toBe(19)
    expect(report.costPerLiter).toBeCloseTo(12.5 / 19, 10)
  })

  it('costPerLiter is null when no volume is known or nothing is priced', () => {
    const noVolume = computeBatchCost({
      batch: batch(),
      txns: [txn({ inventoryItemId: PALE.id, delta: -5 })],
      items: [PALE],
    })
    expect(noVolume.volume_L).toBeNull()
    expect(noVolume.costPerLiter).toBeNull()

    const nothingPriced = computeBatchCost({
      batch: batch({ results: { intoFermenter_L: 20 } }),
      txns: [
        txn({ inventoryItemId: UNPRICED_YEAST.id, delta: -1, kind: 'yeast', unit: 'packets' }),
      ],
      items: [UNPRICED_YEAST],
    })
    expect(nothingPriced.costPerLiter).toBeNull()
  })

  it('orders lines by pantry kind order, then name', () => {
    const saaz = item({
      id: '11111111-0000-4000-8000-000000000009',
      name: 'Saaz',
      ingredientKind: 'hop',
      amountUnit: 'g',
      pricePerUnit_USD: 0.05,
    })
    const report = computeBatchCost({
      batch: batch(),
      txns: [
        txn({ inventoryItemId: saaz.id, delta: -10, kind: 'hop', unit: 'g' }),
        txn({ inventoryItemId: CASCADE.id, delta: -10, kind: 'hop', unit: 'g' }),
        txn({ inventoryItemId: PALE.id, delta: -1 }),
      ],
      items: [saaz, CASCADE, PALE],
    })
    expect(report.lines.map((l) => l.itemName)).toEqual(['Pale Malt', 'Cascade', 'Saaz'])
  })

  it('returns an empty report for a batch with no ledger movements', () => {
    const report = computeBatchCost({ batch: batch(), txns: [], items: [] })
    expect(report).toEqual({
      lines: [],
      knownCost: 0,
      unknownLines: [],
      volume_L: null,
      costPerLiter: null,
      currency: 'USD',
    })
  })
})
