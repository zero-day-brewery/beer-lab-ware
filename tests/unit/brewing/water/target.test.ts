import { describe, expect, it } from 'vitest'
import {
  deriveWaterStyle,
  so4ClBand,
  TARGET_PROFILES,
  targetForRecipe,
} from '@/lib/brewing/water/target'

describe('target profiles', () => {
  it('light-hoppy is sulfate-forward (SO4 275 / Cl 50)', () => {
    expect(TARGET_PROFILES['light-hoppy'].SO4_ppm).toBe(275)
    expect(TARGET_PROFILES['light-hoppy'].Cl_ppm).toBe(50)
  })
  it('dark-stout carries alkalinity (HCO3 200)', () => {
    expect(TARGET_PROFILES['dark-stout'].HCO3_ppm).toBe(200)
  })
})

describe('deriveWaterStyle (SRM + BU:GU grid)', () => {
  it('light + hoppy → light-hoppy', () => {
    expect(deriveWaterStyle(5, 1.0)).toBe('light-hoppy')
  })
  it('light + malty → pale-lager', () => {
    expect(deriveWaterStyle(4, 0.3)).toBe('pale-lager')
  })
  it('amber + malty → amber-malty', () => {
    expect(deriveWaterStyle(10, 0.4)).toBe('amber-malty')
  })
  it('dark → dark-stout regardless of balance', () => {
    expect(deriveWaterStyle(35, 0.9)).toBe('dark-stout')
  })
  it('targetForRecipe returns the matching profile', () => {
    const { styleKey, target } = targetForRecipe(5, 1.0)
    expect(styleKey).toBe('light-hoppy')
    expect(target.SO4_ppm).toBe(275)
  })
})

describe('so4ClBand', () => {
  it('bands by ratio', () => {
    expect(so4ClBand(0.3).label).toMatch(/malty/i)
    expect(so4ClBand(1.5).label).toMatch(/balanced/i)
    expect(so4ClBand(3).label).toMatch(/hop/i)
    expect(so4ClBand(6).label).toMatch(/dry/i)
  })
})
