import { describe, expect, it } from 'vitest'
import { computeAdditions } from '@/lib/brewing/water/additions'
import { ZERO_PROFILE } from '@/lib/brewing/water/ions'
import { TARGET_PROFILES } from '@/lib/brewing/water/target'

describe('computeAdditions: RO → light-hoppy in 30 L', () => {
  const r = computeAdditions(ZERO_PROFILE, TARGET_PROFILES['light-hoppy'], 30)
  it('hits the SO4 and Cl targets', () => {
    expect(r.result.SO4_ppm).toBeCloseTo(275, 0)
    expect(r.result.Cl_ppm).toBeCloseTo(50, 0)
  })
  it('lands Ca in a sane range as a byproduct', () => {
    expect(r.result.Ca_ppm).toBeGreaterThan(95)
    expect(r.result.Ca_ppm).toBeLessThan(135)
  })
  it('hits Mg via epsom', () => {
    expect(r.result.Mg_ppm).toBeCloseTo(18, 0)
  })
  it('uses gypsum + CaCl2 + epsom, no baking soda (HCO3 target 0)', () => {
    expect(r.grams.gypsum).toBeGreaterThan(0)
    expect(r.grams.cacl2).toBeGreaterThan(0)
    expect(r.grams.epsom).toBeGreaterThan(0)
    expect(r.grams.nahco3).toBe(0)
  })
  it('SO4:Cl ratio reflects hoppy water', () => {
    expect(r.so4cl).toBeGreaterThan(4)
  })
})

describe('computeAdditions guardrails', () => {
  it('warns when source already exceeds target (cannot remove ions by salting)', () => {
    const source = { ...ZERO_PROFILE, SO4_ppm: 400 }
    const r = computeAdditions(source, TARGET_PROFILES['light-hoppy'], 30)
    expect(r.grams.gypsum).toBe(0)
    expect(r.warnings.join(' ')).toMatch(/dilute with RO/i)
  })
  it('adds baking soda for a dark target (HCO3 deficit)', () => {
    const r = computeAdditions(ZERO_PROFILE, TARGET_PROFILES['dark-stout'], 30)
    expect(r.grams.nahco3).toBeGreaterThan(0)
    expect(r.result.HCO3_ppm).toBeCloseTo(200, 0)
  })
})
