import { describe, expect, it } from 'vitest'
import { computeBatchCost } from '@/lib/brewing/report/batch-cost'
import { buildBatchRecord } from '@/lib/brewing/report/batch-record'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { buildBatchWorkbook } from '@/lib/report/batch-xlsx'

const NOW = new Date('2026-07-10T12:00:00.000Z')

const batch: Batch = {
  id: '22222222-2222-4222-8222-222222222222',
  batchNo: 4,
  name: 'SMaSH #4',
  status: 'complete',
  process: [],
  logs: [
    {
      key: 'measuredOG',
      label: 'Measured OG',
      stepId: 'measure-og',
      value: 1.049,
      at: '2026-06-25T15:00:00.000Z',
    },
  ],
  timers: [],
  results: { measuredOG: 1.049, measuredFG: 1.011, intoFermenter_L: 18.7 },
  tasting: { rating: 4, overall_md: 'Clean.' },
  startedAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-07-09T12:00:00.000Z',
  schemaVersion: 1,
}

const item: InventoryItem = {
  id: '11111111-0000-4000-8000-000000000001',
  name: 'Pale Malt',
  ingredientKind: 'fermentable',
  amount: 10,
  amountUnit: 'kg',
  pricePerUnit_USD: 2.5,
  status: 'sealed',
  notes_md: '',
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
  schemaVersion: 1,
}

const deduct: StockTransaction = {
  id: '00000000-0000-4000-8000-000000000001',
  inventoryItemId: item.id,
  kind: 'fermentable',
  delta: -5,
  unit: 'kg',
  reason: 'brew-deduct',
  batchId: batch.id,
  at: '2026-06-25T12:30:00.000Z',
  schemaVersion: 1,
}

const readings = [
  {
    id: 'aaaa1111-0000-4000-8000-000000000001',
    batchId: batch.id,
    at: '2026-06-26T12:00:00.000Z',
    gravity: 1.03,
    tempC: 20,
    schemaVersion: 1 as const,
  },
]

function sheetText(ws: { eachRow: (cb: (row: { values: unknown }) => void) => void }): string {
  const parts: string[] = []
  ws.eachRow((row) => {
    parts.push((row.values as unknown[]).map((v) => String(v ?? '')).join('|'))
  })
  return parts.join('\n')
}

describe('buildBatchWorkbook', () => {
  it('builds Batch, Timeline, Readings, and Cost sheets when the batch has cost lines', async () => {
    const cost = computeBatchCost({ batch, txns: [deduct], items: [item] })
    const record = buildBatchRecord({ batch, readings, cost, units: 'metric', generatedAt: NOW })
    const wb = await buildBatchWorkbook(record)

    expect(wb.worksheets.map((w) => w.name)).toEqual(['Batch', 'Timeline', 'Readings', 'Cost'])

    const batchSheet = wb.getWorksheet('Batch')
    if (!batchSheet) throw new Error('Batch sheet missing')
    const batchText = sheetText(batchSheet)
    expect(batchText).toContain('Batch Record — #4 · SMaSH #4')
    expect(batchText).toContain('Batch #|4')
    expect(batchText).toContain('OG|—|1.049')
    expect(batchText).toContain('Rating|4 / 5')

    const readingsSheet = wb.getWorksheet('Readings')
    if (!readingsSheet) throw new Error('Readings sheet missing')
    expect(sheetText(readingsSheet)).toContain('2026-06-26T12:00:00.000Z|1.030|20.0')

    const costSheet = wb.getWorksheet('Cost')
    if (!costSheet) throw new Error('Cost sheet missing')
    const costText = sheetText(costSheet)
    expect(costText).toContain('Known cost: $12.50 USD')
    expect(costText).toContain('Cost per L: $0.67 USD')
    expect(costText).toContain('Pale Malt|Fermentable|5|kg|$2.50|$12.50')
  })

  it('omits the Cost sheet when the batch has no cost lines', async () => {
    const cost = computeBatchCost({ batch, txns: [], items: [] })
    const record = buildBatchRecord({
      batch,
      readings: [],
      cost,
      units: 'metric',
      generatedAt: NOW,
    })
    const wb = await buildBatchWorkbook(record)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Batch', 'Timeline', 'Readings'])
  })

  it('surfaces unpriced lines on the Cost sheet summary', async () => {
    const unpricedItem = {
      ...item,
      id: '11111111-0000-4000-8000-000000000002',
      name: 'Mystery Hop',
    }
    delete (unpricedItem as { pricePerUnit_USD?: number }).pricePerUnit_USD
    const cost = computeBatchCost({
      batch,
      txns: [
        deduct,
        { ...deduct, id: '00000000-0000-4000-8000-000000000002', inventoryItemId: unpricedItem.id },
      ],
      items: [item, unpricedItem],
    })
    const record = buildBatchRecord({
      batch,
      readings: [],
      cost,
      units: 'metric',
      generatedAt: NOW,
    })
    const wb = await buildBatchWorkbook(record)
    const costSheet = wb.getWorksheet('Cost')
    if (!costSheet) throw new Error('Cost sheet missing')
    expect(sheetText(costSheet)).toContain('1 item unpriced — excluded from the total')
  })

  it('labels cost-per-volume in gallons for imperial records', async () => {
    const cost = computeBatchCost({ batch, txns: [deduct], items: [item] })
    const record = buildBatchRecord({
      batch,
      readings: [],
      cost,
      units: 'imperial',
      generatedAt: NOW,
    })
    const wb = await buildBatchWorkbook(record)
    const costSheet = wb.getWorksheet('Cost')
    if (!costSheet) throw new Error('Cost sheet missing')
    // 12.50 / 4.94 gal ≈ $2.53/gal
    expect(sheetText(costSheet)).toContain('Cost per gal: $2.53 USD')
  })
})
