import { describe, expect, it } from 'vitest'
import { applyAdditions, saltPpmPerGramPerL, ZERO_PROFILE } from '@/lib/brewing/water/ions'

describe('saltPpmPerGramPerL', () => {
  it('gypsum: 1 g/L → Ca 232.8, SO4 557.9', () => {
    const p = saltPpmPerGramPerL('gypsum')
    expect(p.Ca).toBeCloseTo(232.8, 0)
    expect(p.SO4).toBeCloseTo(557.9, 0)
  })
  it('CaCl2 dihydrate (default) → Ca 272.6, Cl 482.3; anhydrous → 361.1 / 638.9', () => {
    const d = saltPpmPerGramPerL('cacl2')
    expect(d.Ca).toBeCloseTo(272.6, 0)
    expect(d.Cl).toBeCloseTo(482.3, 0)
    const a = saltPpmPerGramPerL('cacl2', 'anhydrous')
    expect(a.Ca).toBeCloseTo(361.1, 0)
    expect(a.Cl).toBeCloseTo(638.9, 0)
  })
  it('epsom → Mg 98.6 / SO4 389.7; NaCl → Na 393.4 / Cl 606.6; NaHCO3 → Na 273.7 / HCO3 726.3', () => {
    expect(saltPpmPerGramPerL('epsom').Mg).toBeCloseTo(98.6, 0)
    expect(saltPpmPerGramPerL('epsom').SO4).toBeCloseTo(389.7, 0)
    expect(saltPpmPerGramPerL('nacl').Na).toBeCloseTo(393.4, 0)
    expect(saltPpmPerGramPerL('nahco3').HCO3).toBeCloseTo(726.3, 0)
  })
})

describe('applyAdditions', () => {
  it('adds ppm = perGperL × grams / volume', () => {
    const out = applyAdditions(ZERO_PROFILE, { gypsum: 6 }, 30)
    expect(out.Ca_ppm).toBeCloseTo((232.8 * 6) / 30, 1)
    expect(out.SO4_ppm).toBeCloseTo((557.9 * 6) / 30, 1)
    expect(out.Cl_ppm).toBe(0)
  })
  it('does not mutate the source', () => {
    const src = { ...ZERO_PROFILE, Ca_ppm: 10 }
    applyAdditions(src, { gypsum: 6 }, 30)
    expect(src.Ca_ppm).toBe(10)
  })
})
