import { describe, expect, it } from 'vitest'

import {
  buildInsights,
  detectYeastLowViability,
  type InsightContext,
} from '@/lib/brewing/insights/detectors'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const NOW = new Date('2026-06-01T00:00:00.000Z')

function yeastLot(over: Partial<YeastLot> & { daysAgo: number }): YeastLot {
  const { daysAgo, ...rest } = over
  return {
    id: crypto.randomUUID(),
    name: 'WLP001 California Ale',
    strain: 'California Ale',
    form: 'liquid',
    initialCells_B: 100,
    generation: 0,
    quantity: 1,
    unit: 'vial',
    notes_md: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
    productionDate: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    ...rest,
  }
}

function ctx(yeastLots: YeastLot[]): InsightContext {
  return { batches: [], readingsByBatch: {}, inventory: [], now: NOW, yeastLots }
}

describe('detectYeastLowViability', () => {
  it('no nudge for a fresh lot', () => {
    expect(detectYeastLowViability(ctx([yeastLot({ daysAgo: 3 })]))).toHaveLength(0)
  })

  it('warns when a lot approaches the floor (in the warn band)', () => {
    const out = detectYeastLowViability(ctx([yeastLot({ daysAgo: 53 })])) // ~60%
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('warn')
    expect(out[0].kind).toBe('yeast_low_viability')
  })

  it('is urgent below the direct-pitch floor', () => {
    const out = detectYeastLowViability(ctx([yeastLot({ daysAgo: 82 })])) // ~40% < 50
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('urgent')
  })

  it('ignores out-of-stock lots', () => {
    expect(detectYeastLowViability(ctx([yeastLot({ daysAgo: 82, quantity: 0 })]))).toHaveLength(0)
  })

  it('buildInsights includes it and tolerates undefined yeastLots', () => {
    const withLot = buildInsights(ctx([yeastLot({ daysAgo: 82 })]))
    expect(withLot.some((i) => i.kind === 'yeast_low_viability')).toBe(true)
    // legacy context with no yeastLots field must not throw
    const legacy = buildInsights({ batches: [], readingsByBatch: {}, inventory: [], now: NOW })
    expect(Array.isArray(legacy)).toBe(true)
  })
})
