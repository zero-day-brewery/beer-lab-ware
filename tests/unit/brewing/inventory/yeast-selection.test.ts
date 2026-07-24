import { describe, expect, it } from 'vitest'

import { selectYeastLot, VIABILITY_FLOOR_PCT } from '@/lib/brewing/inventory/yeast-selection'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const NOW = new Date('2026-06-01T00:00:00.000Z')

function lot(over: Partial<YeastLot> & { id: string; daysAgo: number }): YeastLot {
  const { daysAgo, ...rest } = over
  return {
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
  } as YeastLot
}

describe('selectYeastLot', () => {
  it('returns make-starter-or-buy when no lot matches the strain', () => {
    const sel = selectYeastLot({
      strain: 'Hefeweizen',
      requiredCells_B: 200,
      lots: [lot({ id: 'a', daysAgo: 5 })],
      now: NOW,
    })
    expect(sel.chosen).toBeNull()
    expect(sel.action).toBe('make-starter-or-buy')
  })

  it('picks the OLDEST still-viable lot (FIFO within the viable set)', () => {
    // both viable (fresh); older is a, initial cells lower — FIFO still wins
    const older = lot({ id: 'older', daysAgo: 20, initialCells_B: 80 })
    const newer = lot({ id: 'newer', daysAgo: 2, initialCells_B: 100 })
    const sel = selectYeastLot({
      strain: 'California Ale',
      requiredCells_B: 50,
      lots: [newer, older],
      now: NOW,
    })
    expect(sel.chosen?.id).toBe('older')
    expect(sel.action).toBe('pitch')
  })

  it('skips a below-floor older lot and picks the viable newer one', () => {
    const tooOld = lot({ id: 'stale', daysAgo: 90 }) // 97 − 63 = 34% < floor
    const fresh = lot({ id: 'fresh', daysAgo: 5 }) // 93.5%
    expect(currentBelowFloor(tooOld)).toBe(true)
    const sel = selectYeastLot({
      strain: 'California Ale',
      requiredCells_B: 50,
      lots: [tooOld, fresh],
      now: NOW,
    })
    expect(sel.chosen?.id).toBe('fresh')
  })

  it('recommends a starter when the chosen viable lot is short on cells', () => {
    const single = lot({ id: 'x', daysAgo: 10, initialCells_B: 100 }) // 90% → 90B viable
    const sel = selectYeastLot({
      strain: 'California Ale',
      requiredCells_B: 200,
      lots: [single],
      now: NOW,
    })
    expect(sel.chosen?.id).toBe('x')
    expect(sel.action).toBe('pitch-with-starter')
    expect(sel.starterRecommended).toBe(true)
    expect(sel.cellDeficit_B).toBeCloseTo(110, 0) // 200 − 90
  })

  it('excludes out-of-stock lots and matches strain case-insensitively', () => {
    const empty = lot({ id: 'empty', daysAgo: 2, quantity: 0 })
    const stocked = lot({ id: 'stocked', daysAgo: 3, strain: '  california ale ' })
    const sel = selectYeastLot({
      strain: 'California Ale',
      requiredCells_B: 50,
      lots: [empty, stocked],
      now: NOW,
    })
    expect(sel.chosen?.id).toBe('stocked')
  })

  it('a below-floor lot with a HEALTHY direct measurement is STILL floored (conservative)', () => {
    // 90-day liquid lot = 34% est. viability → below the age floor, even though a
    // fresh count says it holds 300 B live cells. selectYeastLot floors on age
    // (currentViability), never on the measured count — so it over-recommends a
    // starter rather than risk under-pitching an old lot. Guards the invariant.
    const agedButMeasured = lot({
      id: 'aged',
      daysAgo: 90,
      measuredViableCells_B: 300,
      measuredAt: NOW.toISOString(),
    })
    expect(currentBelowFloor(agedButMeasured)).toBe(true)
    const sel = selectYeastLot({
      strain: 'California Ale',
      requiredCells_B: 200,
      lots: [agedButMeasured],
      now: NOW,
    })
    expect(sel.chosen).toBeNull()
    expect(sel.action).toBe('make-starter-or-buy')
  })
})

// helper mirrors the engine's floor check for the "skips below-floor" assertion
function currentBelowFloor(l: YeastLot): boolean {
  const days = (NOW.getTime() - new Date(l.productionDate).getTime()) / 86_400_000
  return 97 - 0.7 * days < VIABILITY_FLOOR_PCT
}
