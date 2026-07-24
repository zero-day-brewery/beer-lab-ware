import { describe, expect, it } from 'vitest'

import { currentViability, viableCells } from '@/lib/brewing/inventory/yeast-viability'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const base: Omit<YeastLot, 'form' | 'productionDate' | 'initialCells_B'> = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Test Yeast',
  strain: 'California Ale',
  generation: 0,
  quantity: 1,
  unit: 'vial',
  notes_md: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 1,
}

function lot(form: YeastLot['form'], daysAgo: number, initialCells_B = 100): YeastLot {
  const now = new Date('2026-06-01T00:00:00.000Z')
  const prod = new Date(now.getTime() - daysAgo * 86_400_000)
  return { ...base, form, productionDate: prod.toISOString(), initialCells_B }
}
const NOW = new Date('2026-06-01T00:00:00.000Z')

describe('currentViability', () => {
  it('liquid: 97% at production, −0.7%/day', () => {
    expect(currentViability(lot('liquid', 0), NOW)).toBeCloseTo(97, 5)
    expect(currentViability(lot('liquid', 10), NOW)).toBeCloseTo(90, 5) // 97 − 7
  })

  it('dry: near-flat decline (far more stable than liquid)', () => {
    const v30 = currentViability(lot('dry', 30), NOW)
    expect(v30).toBeGreaterThan(95) // ~97.4 — barely moved in a month
    expect(v30).toBeLessThan(98)
  })

  it('slurry: declines faster than liquid', () => {
    const vs = currentViability(lot('slurry', 10), NOW)
    const vl = currentViability(lot('liquid', 10), NOW)
    expect(vs).toBeLessThan(vl)
  })

  it('clamps to 0–100', () => {
    expect(currentViability(lot('liquid', 500), NOW)).toBe(0)
    expect(currentViability(lot('liquid', -5), NOW)).toBeLessThanOrEqual(100)
  })
})

describe('viableCells', () => {
  it('scales initial cells by current viability', () => {
    // liquid 10d → 90% of 100B = 90B
    expect(viableCells(lot('liquid', 10, 100), NOW)).toBeCloseTo(90, 5)
  })

  it('is 0 when fully decayed', () => {
    expect(viableCells(lot('liquid', 500, 100), NOW)).toBe(0)
  })
})

describe('viableCells — measured override', () => {
  // A lot with a direct hemocytometer count taken `measuredDaysAgo` before NOW.
  function measured(
    form: YeastLot['form'],
    measuredDaysAgo: number,
    measuredViableCells_B: number,
    initialCells_B = 100,
    prodDaysAgo = measuredDaysAgo,
  ): YeastLot {
    return {
      ...lot(form, prodDaysAgo, initialCells_B),
      measuredViableCells_B,
      measuredAt: new Date(NOW.getTime() - measuredDaysAgo * 86_400_000).toISOString(),
    }
  }

  it('at the measurement instant, returns the measured count exactly — overriding the age estimate', () => {
    // 60-day-old slurry: the age estimate would be ~12 B (90−1.3·60 = 12%);
    // a fresh count says 200 B. The measurement wins.
    const lot60 = measured('slurry', 0, 200, 100, 60)
    expect(viableCells(lot('slurry', 60, 100), NOW)).toBeCloseTo(12, 5) // estimate, for contrast
    expect(viableCells(lot60, NOW)).toBeCloseTo(200, 5)
  })

  it('an on-model measurement reproduces the age estimate later — no clock-reset lifespan extension', () => {
    // liquid, initial 100 B. Age model 97−0.7·day%: day30 → 76 B, day60 → 55 B.
    // A 76 B count taken at day30 (exactly on-model) MUST decay to 55 B at day60,
    // not overstate — the measurement re-anchors the LEVEL, not the decline rate.
    // (Regression: fractional retention gave 59.5 B here → shrank the deficit →
    // could flip pitch-with-starter into a bare under-pitch.)
    const onModel = measured('liquid', 30, 76, 100, 60)
    expect(viableCells(lot('liquid', 60, 100), NOW)).toBeCloseTo(55, 5) // age estimate, for contrast
    expect(viableCells(onModel, NOW)).toBeCloseTo(55, 5)
  })

  it("decays forward at the lot's own absolute rate: initialCells × lossPctPerDay/100 B/day", () => {
    // slurry, initial 100 B → 100 × 1.3/100 = 1.3 B/day. A 120 B count 10 days ago
    // → 120 − 1.3·10 = 107 B now (distinct from the fractional model's 102.7 B).
    const l = measured('slurry', 10, 120, 100, 20)
    expect(viableCells(l, NOW)).toBeCloseTo(120 - 1.3 * 10, 5)
  })

  it('never grows above the measured count (a future measuredAt clamps forward-decay at 0 days)', () => {
    const l = measured('slurry', -5, 200) // measuredAt 5 days in the FUTURE
    expect(viableCells(l, NOW)).toBeCloseTo(200, 5)
  })

  it('clamps to zero, never negative, when the measurement is ancient', () => {
    const l = measured('slurry', 200, 200) // 200d past, well beyond the ~69d zero-crossing
    expect(viableCells(l, NOW)).toBe(0)
  })

  it('falls back to the age estimate unless BOTH measured fields are present', () => {
    const estimate = viableCells(lot('slurry', 10, 100), NOW)
    const onlyValue: YeastLot = { ...lot('slurry', 10, 100), measuredViableCells_B: 200 }
    const onlyDate: YeastLot = { ...lot('slurry', 10, 100), measuredAt: NOW.toISOString() }
    expect(viableCells(onlyValue, NOW)).toBeCloseTo(estimate, 5)
    expect(viableCells(onlyDate, NOW)).toBeCloseTo(estimate, 5)
  })
})
