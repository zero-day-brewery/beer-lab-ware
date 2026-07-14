import { describe, expect, it } from 'vitest'
import { hopFormFactor } from '@/lib/brewing/calc/hop-form'
import { calcIBU } from '@/lib/brewing/calc/ibu'
import { calcIBUTinseth } from '@/lib/brewing/calc/ibu/tinseth'
import type { HopUse } from '@/lib/brewing/types/recipe-parts'

describe('hopFormFactor', () => {
  it('pellet and cryo get the +10% bonus', () => {
    expect(hopFormFactor('pellet')).toBeCloseTo(1.1, 10)
    expect(hopFormFactor('cryo')).toBeCloseTo(1.1, 10)
  })

  it('whole/leaf, plug, and extract are neutral (1.0)', () => {
    expect(hopFormFactor('leaf')).toBe(1.0)
    expect(hopFormFactor('plug')).toBe(1.0)
    expect(hopFormFactor('extract')).toBe(1.0)
  })

  it('missing/undefined form defaults to 1.0 (whole)', () => {
    expect(hopFormFactor(undefined)).toBe(1.0)
  })
})

describe('hop form factor in IBU (Tinseth)', () => {
  // Same alpha / amount / time / gravity / volume — only the form differs.
  const base = (form: HopUse['snapshot']['form']): HopUse => ({
    ingredientId: '550e8400-e29b-41d4-a716-446655440201',
    snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form },
    amount_g: 28,
    time_min: 60,
    use: 'boil',
  })

  const ibu = (form: HopUse['snapshot']['form']) => calcIBUTinseth([base(form)], 1.052, 19, 1.0)

  it('pellet IBU > whole/leaf IBU for the same hop', () => {
    expect(ibu('pellet')).toBeGreaterThan(ibu('leaf'))
  })

  it('pellet IBU is exactly ~10% higher than leaf', () => {
    expect(ibu('pellet')).toBeCloseTo(ibu('leaf') * 1.1, 6)
  })

  it('cryo matches pellet (both +10%)', () => {
    expect(ibu('cryo')).toBeCloseTo(ibu('pellet'), 6)
  })

  it('leaf, plug, and extract are all equal (neutral form)', () => {
    expect(ibu('plug')).toBeCloseTo(ibu('leaf'), 10)
    expect(ibu('extract')).toBeCloseTo(ibu('leaf'), 10)
  })

  it('leaf reference value ≈ 18.36 IBU (no form bonus)', () => {
    expect(ibu('leaf')).toBeCloseTo(18.36, 1)
  })

  it('each factor scales the contribution by exactly hopFormFactor(form)', () => {
    const leafIbu = ibu('leaf')
    for (const form of ['leaf', 'plug', 'extract', 'pellet', 'cryo'] as const) {
      expect(ibu(form)).toBeCloseTo(leafIbu * hopFormFactor(form), 6)
    }
  })

  it('dry-hop / 0-IBU additions stay 0 — the form factor does not resurrect them', () => {
    const dryHopPellet: HopUse = { ...base('pellet'), use: 'dry-hop', time_min: 0 }
    expect(calcIBUTinseth([dryHopPellet], 1.052, 19, 1.0)).toBe(0)
    // through the dispatcher too
    expect(calcIBU([dryHopPellet], 1.052, 19, 1.0, 'tinseth')).toBe(0)
  })
})
