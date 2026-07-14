import { describe, expect, it } from 'vitest'
import { calcMCU, calcSRM } from '@/lib/brewing/calc/srm'
import { calcSRMDaniels } from '@/lib/brewing/calc/srm/daniels'
import { calcSRMMorey } from '@/lib/brewing/calc/srm/morey'
import { calcSRMMosher } from '@/lib/brewing/calc/srm/mosher'
import type { FermentableUse } from '@/lib/brewing/types/recipe-parts'

const twoRow: FermentableUse = {
  ingredientId: '550e8400-e29b-41d4-a716-446655440101',
  snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
  amount_kg: 4.5,
  usage: 'mash',
  afterBoil: false,
}
const crystal: FermentableUse = {
  ingredientId: '550e8400-e29b-41d4-a716-446655440102',
  snapshot: { name: 'Crystal 60', type: 'specialty', ppg: 34, color_L: 60 },
  amount_kg: 0.3,
  usage: 'mash',
  afterBoil: false,
}

describe('calcMCU', () => {
  it('4.5kg pale (2L) + 0.3kg crystal (60L) in 19L ≈ 11.86 MCU', () => {
    expect(calcMCU([twoRow, crystal], 19)).toBeCloseTo(11.86, 1)
  })

  it('empty grain bill → 0', () => {
    expect(calcMCU([], 19)).toBe(0)
  })
})

describe('Morey SRM', () => {
  it('MCU 11.86 → ~8.1 SRM', () => {
    expect(calcSRMMorey(11.86)).toBeCloseTo(8.14, 1)
  })
  it('SRM saturates around 50 for very high MCU', () => {
    expect(calcSRMMorey(1000)).toBeLessThan(60)
  })
  it('MCU 0 → 0 SRM', () => {
    expect(calcSRMMorey(0)).toBe(0)
  })
})

describe('Daniels SRM', () => {
  it('MCU 11.86 → 0.2 × 11.86 + 8.4 = 10.77', () => {
    expect(calcSRMDaniels(11.86)).toBeCloseTo(10.77, 1)
  })
})

describe('Mosher SRM', () => {
  it('MCU 11.86 → 0.3 × 11.86 + 4.7 = 8.26', () => {
    expect(calcSRMMosher(11.86)).toBeCloseTo(8.26, 1)
  })
})

describe('calcSRM dispatcher', () => {
  it('dispatches to morey', () => {
    expect(calcSRM([twoRow, crystal], 19, 'morey')).toBeCloseTo(8.14, 1)
  })
  it('dispatches to daniels', () => {
    expect(calcSRM([twoRow, crystal], 19, 'daniels')).toBeCloseTo(10.77, 1)
  })
  it('dispatches to mosher', () => {
    expect(calcSRM([twoRow, crystal], 19, 'mosher')).toBeCloseTo(8.26, 1)
  })
})
