import { describe, expect, it } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { computeBatchCost } from '@/lib/brewing/report/batch-cost'
import {
  BATCH_COST_COLUMNS,
  batchLogColumns,
  batchReadingColumns,
  batchRecordFilename,
  buildBatchRecord,
} from '@/lib/brewing/report/batch-record'
import type { ReportContext } from '@/lib/brewing/report/columns'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'

const NOW = new Date('2026-07-10T12:00:00.000Z')
const CTX: ReportContext = { generatedAt: NOW }

const recipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: 'x',
      snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
}

const batch: Batch = {
  id: '22222222-2222-4222-8222-222222222222',
  batchNo: 4,
  name: 'SMaSH #4',
  status: 'complete',
  recipeSnapshot: recipe,
  computedTargets: calculateRecipe(recipe, B40PRO_PROFILE, '2026-06-25T12:00:00.000Z'),
  process: [],
  logs: [
    {
      key: 'intoFermenter_L',
      label: 'Into fermenter',
      stepId: 'measure-og',
      value: 18.7,
      unit: 'L',
      target: 19,
      at: '2026-06-25T15:00:00.000Z',
    },
    {
      key: 'note',
      label: 'Brew note',
      stepId: 'boil',
      value: 'vigorous boil',
      at: '2026-06-25T14:00:00.000Z',
    },
  ],
  timers: [],
  results: { measuredOG: 1.049, measuredFG: 1.011, measuredABV: 4.99, intoFermenter_L: 18.7 },
  tasting: { rating: 4, overall_md: 'Clean, bready.' },
  startedAt: '2026-06-25T12:00:00.000Z',
  brewedAt: '2026-06-25T12:30:00.000Z',
  completedAt: '2026-07-09T12:00:00.000Z',
  updatedAt: '2026-07-09T12:00:00.000Z',
  schemaVersion: 1,
}

const emptyCost = computeBatchCost({ batch, txns: [], items: [] })

describe('buildBatchRecord', () => {
  const record = buildBatchRecord({
    batch,
    readings: [
      {
        id: 'r1',
        batchId: batch.id,
        at: '2026-06-26T12:00:00.000Z',
        gravity: 1.03,
        tempC: 20,
        schemaVersion: 1,
      },
    ],
    cost: emptyCost,
    units: 'metric',
    generatedAt: NOW,
  })

  it('carries batch metadata rows', () => {
    const labels = record.meta.map((m) => m.label)
    expect(labels).toContain('Batch #')
    expect(record.meta.find((m) => m.label === 'Batch #')?.value).toBe('4')
    expect(record.meta.find((m) => m.label === 'Name')?.value).toBe('SMaSH #4')
    expect(record.meta.find((m) => m.label === 'Status')?.value).toBe('complete')
    expect(record.meta.find((m) => m.label === 'Recipe')?.value).toBe('SMaSH')
  })

  it('builds results-vs-targets rows (targets from computedTargets, actuals from results)', () => {
    const og = record.targetsVsActuals.find((r) => r.metric === 'OG')
    expect(og?.target).toBe(batch.computedTargets?.OG.toFixed(3))
    expect(og?.actual).toBe('1.049')
    const fg = record.targetsVsActuals.find((r) => r.metric === 'FG')
    expect(fg?.actual).toBe('1.011')
    const vol = record.targetsVsActuals.find((r) => r.metric.startsWith('Into fermenter'))
    expect(vol?.actual).toBe('18.70')
  })

  it('formats volumes in the display units (imperial → gal)', () => {
    const imperial = buildBatchRecord({
      batch,
      readings: [],
      cost: emptyCost,
      units: 'imperial',
      generatedAt: NOW,
    })
    const vol = imperial.targetsVsActuals.find((r) => r.metric.startsWith('Into fermenter'))
    expect(vol?.metric).toContain('gal')
    expect(vol?.actual).toBe('4.94')
  })

  it('carries tasting rows only for the fields present', () => {
    const labels = record.tasting.map((t) => t.label)
    expect(labels).toEqual(['Rating', 'Overall'])
    expect(record.tasting.find((t) => t.label === 'Rating')?.value).toBe('4 / 5')
  })

  it('passes logs + readings + cost through for the sheet builders', () => {
    expect(record.logs).toHaveLength(2)
    expect(record.readings).toHaveLength(1)
    expect(record.cost).toBe(emptyCost)
    expect(record.subtitle).toContain('#4')
  })
})

describe('batch record columns', () => {
  it('reading columns honor units for temperature', () => {
    const reading = {
      id: 'r1',
      batchId: 'b',
      at: '2026-06-26T12:00:00.000Z',
      gravity: 1.03,
      tempC: 20,
      ph: 4.5,
      note: 'ok',
      schemaVersion: 1 as const,
    }
    const metric = batchReadingColumns('metric')
    expect(metric.map((c) => c.get(reading, CTX))).toEqual([
      '2026-06-26T12:00:00.000Z',
      '1.030',
      '20.0',
      '4.50',
      'ok',
    ])
    const imperial = batchReadingColumns('imperial')
    expect(imperial[2]?.header).toBe('Temp (°F)')
    expect(imperial[2]?.get(reading, CTX)).toBe('68.0')
  })

  it('log columns convert canonical-L values in imperial and leave strings alone', () => {
    const cols = batchLogColumns('imperial')
    const row = cols.map((c) => c.get(batch.logs[0] as never, CTX))
    expect(row).toContain('Into fermenter')
    expect(row).toContain('4.94 gal')
    const noteRow = cols.map((c) => c.get(batch.logs[1] as never, CTX))
    expect(noteRow).toContain('vigorous boil')
  })

  it('cost columns render unpriced cells as em-dash and USD money with $', () => {
    const priced = {
      itemName: 'Pale',
      kind: 'fermentable' as const,
      qty: 5,
      unit: 'kg' as const,
      unitPrice: 2.5,
      cost: 12.5,
    }
    const unpriced = { ...priced, itemName: 'US-05', unitPrice: null, cost: null }
    const row = BATCH_COST_COLUMNS.map((c) => c.get(priced, CTX))
    expect(row).toEqual(['Pale', 'Fermentable', '5', 'kg', '$2.50', '$12.50'])
    const row2 = BATCH_COST_COLUMNS.map((c) => c.get(unpriced, CTX))
    expect(row2).toEqual(['US-05', 'Fermentable', '5', 'kg', '—', '—'])
  })
})

describe('batchRecordFilename', () => {
  it('derives a dated, batch-numbered filename', () => {
    expect(batchRecordFilename(record())).toBe('beer-lab-ware-batch-4-record-2026-07-10.xlsx')
  })
})

function record() {
  return buildBatchRecord({
    batch,
    readings: [],
    cost: emptyCost,
    units: 'metric',
    generatedAt: NOW,
  })
}
