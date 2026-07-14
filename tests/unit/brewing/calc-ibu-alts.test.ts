import { describe, expect, it } from 'vitest'
import { calcIBU } from '@/lib/brewing/calc/ibu'
import { calcIBUDaniels } from '@/lib/brewing/calc/ibu/daniels'
import { calcIBUGaretz } from '@/lib/brewing/calc/ibu/garetz'
import { calcIBURager } from '@/lib/brewing/calc/ibu/rager'
import type { HopUse } from '@/lib/brewing/types/recipe-parts'

const cascade: HopUse = {
  ingredientId: '550e8400-e29b-41d4-a716-446655440201',
  snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
  amount_g: 28,
  time_min: 60,
  use: 'boil',
}

describe('Rager IBU', () => {
  it('60min at 1.052 in 19L in plausible range (20-40)', () => {
    const ibu = calcIBURager([cascade], 1.052, 19, 1.0)
    expect(ibu).toBeGreaterThan(20)
    expect(ibu).toBeLessThan(40)
  })
  it('high gravity reduces IBU', () => {
    expect(calcIBURager([cascade], 1.04, 19, 1.0)).toBeGreaterThan(
      calcIBURager([cascade], 1.08, 19, 1.0),
    )
  })
})

describe('Garetz IBU', () => {
  it('60min at 1.052 in 19L in plausible range (10-35)', () => {
    const ibu = calcIBUGaretz([cascade], 1.052, 19, 1.0)
    expect(ibu).toBeGreaterThan(10)
    expect(ibu).toBeLessThan(35)
  })
})

describe('Daniels IBU', () => {
  it('60min at 1.052 in 19L in plausible range (10-35)', () => {
    const ibu = calcIBUDaniels([cascade], 1.052, 19, 1.0)
    expect(ibu).toBeGreaterThan(10)
    expect(ibu).toBeLessThan(35)
  })
})

describe('calcIBU dispatcher', () => {
  it('dispatches to tinseth', () => {
    // cascade is pellet → base 18.36 × 1.10 form factor ≈ 20.2 (see hop-form.ts).
    const result = calcIBU([cascade], 1.052, 19, 1.0, 'tinseth')
    expect(result).toBeCloseTo(20.2, 0)
  })
  it('dispatches to rager', () => {
    const result = calcIBU([cascade], 1.052, 19, 1.0, 'rager')
    expect(result).toBeGreaterThan(0)
  })
  it('different formulas give different results', () => {
    const t = calcIBU([cascade], 1.052, 19, 1.0, 'tinseth')
    const r = calcIBU([cascade], 1.052, 19, 1.0, 'rager')
    expect(t).not.toBe(r)
    expect(Math.abs(t - r)).toBeLessThan(20)
  })
})
