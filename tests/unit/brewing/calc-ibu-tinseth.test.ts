import { describe, expect, it } from 'vitest'
import { calcIBUTinseth, tinsethUtilization } from '@/lib/brewing/calc/ibu/tinseth'
import type { HopUse } from '@/lib/brewing/types/recipe-parts'

describe('tinsethUtilization', () => {
  it('60min at 1.050 ≈ 0.231', () => {
    expect(tinsethUtilization(60, 1.05)).toBeCloseTo(0.231, 2)
  })

  it('0min = 0', () => {
    expect(tinsethUtilization(0, 1.05)).toBeCloseTo(0, 3)
  })

  it('higher gravity → lower utilization', () => {
    expect(tinsethUtilization(60, 1.04)).toBeGreaterThan(tinsethUtilization(60, 1.07))
  })

  it('longer boil → higher utilization', () => {
    expect(tinsethUtilization(15, 1.05)).toBeLessThan(tinsethUtilization(60, 1.05))
  })
})

describe('calcIBUTinseth', () => {
  const cascadeBoil: HopUse = {
    ingredientId: '550e8400-e29b-41d4-a716-446655440201',
    snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
    amount_g: 28,
    time_min: 60,
    use: 'boil',
  }

  it('single 60min Cascade (pellet) @ OG 1.052 in 19L ≈ 20 IBU', () => {
    // Pellet form factor ×1.10: base 18.36 → 20.2 (see hop-form.ts).
    expect(calcIBUTinseth([cascadeBoil], 1.052, 19, 1.0)).toBeCloseTo(20.2, 0)
  })

  it('dry-hop additions contribute 0 IBU', () => {
    const dryHop: HopUse = { ...cascadeBoil, use: 'dry-hop', time_min: 4 }
    expect(calcIBUTinseth([dryHop], 1.052, 19, 1.0)).toBe(0)
  })

  it('multiplier scales linearly', () => {
    const base = calcIBUTinseth([cascadeBoil], 1.052, 19, 1.0)
    const scaled = calcIBUTinseth([cascadeBoil], 1.052, 19, 1.5)
    expect(scaled).toBeCloseTo(base * 1.5, 1)
  })

  it('multiple additions sum', () => {
    const second: HopUse = { ...cascadeBoil, time_min: 15, amount_g: 14 }
    const total = calcIBUTinseth([cascadeBoil, second], 1.052, 19, 1.0)
    const single = calcIBUTinseth([cascadeBoil], 1.052, 19, 1.0)
    expect(total).toBeGreaterThan(single)
  })

  it('empty hops = 0 IBU', () => {
    expect(calcIBUTinseth([], 1.052, 19, 1.0)).toBe(0)
  })
})
