import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  attenuationTrend,
  efficiencyTrend,
  ogFgAccuracyTrend,
  type TrendPoint,
} from '@/lib/brewing/batch/trends'

// Minimal Batch-shaped fixtures — only the fields the trend fns read.
// Cast through unknown to the param type the module exports.
type TrendBatch = Parameters<typeof efficiencyTrend>[0][number]

function batch(batchNo: number, brewedAt: string, results: TrendBatch['results']): TrendBatch {
  return { batchNo, brewedAt, startedAt: brewedAt, results } as TrendBatch
}

describe('batch trends', () => {
  const batches = [
    batch(2, '2026-02-01T00:00:00.000Z', {
      brewhouseEfficiency_pct: 75,
      measuredOG: 1.05,
      measuredFG: 1.012,
    }),
    batch(1, '2026-01-01T00:00:00.000Z', {
      brewhouseEfficiency_pct: 70,
      measuredOG: 1.06,
      measuredFG: 1.015,
    }),
  ]

  it('efficiencyTrend sorts ascending by batchNo and reads brewhouseEfficiency_pct', () => {
    const t = efficiencyTrend(batches)
    expect(t.map((p) => p.batchNo)).toEqual([1, 2])
    expect(t[0].value).toBe(70)
    expect(t[1].value).toBe(75)
    expect(t[0].date).toBe('2026-01-01T00:00:00.000Z')
  })

  it('attenuationTrend computes ADF from measured OG/FG', () => {
    const t = attenuationTrend(batches)
    // batch 1: 1.060→1.015 = 75%
    expect(t[0].value).toBeCloseTo(75, 1)
  })

  it('ogFgAccuracyTrend yields a point per batch with a measured OG', () => {
    const t = ogFgAccuracyTrend(batches)
    expect(t).toHaveLength(2)
    expect(t[0].batchNo).toBe(1)
  })

  it('skips batches missing the relevant measurement', () => {
    const partial = [batch(3, '2026-03-01T00:00:00.000Z', {}), ...batches]
    expect(efficiencyTrend(partial)).toHaveLength(2) // batch 3 dropped
  })

  it('returns TrendPoint[]', () => {
    const t: TrendPoint[] = efficiencyTrend(batches)
    expect(Array.isArray(t)).toBe(true)
  })

  it('PURE: imports no DOM/Dexie/fetch', () => {
    const src = readFileSync(
      new URL('../../../src/lib/brewing/batch/trends.ts', import.meta.url),
      'utf8',
    )
    expect(src).not.toMatch(/from 'dexie'/)
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/)
    expect(src).not.toMatch(/\bfetch\(/)
  })
})
