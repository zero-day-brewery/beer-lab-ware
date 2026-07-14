import { describe, expect, it } from 'vitest'
import { so4ClBand, so4ClRatio } from '@/lib/brewing/water/target'

describe('so4ClRatio', () => {
  it('divides SO₄ by Cl', () => {
    expect(so4ClRatio({ SO4_ppm: 200, Cl_ppm: 100 })).toBe(2)
    expect(so4ClRatio({ SO4_ppm: 50, Cl_ppm: 100 })).toBe(0.5)
  })

  it('returns +Infinity when Cl is zero (matches computeAdditions convention)', () => {
    expect(so4ClRatio({ SO4_ppm: 100, Cl_ppm: 0 })).toBe(Number.POSITIVE_INFINITY)
  })

  it('is zero when SO₄ is zero and Cl is present', () => {
    expect(so4ClRatio({ SO4_ppm: 0, Cl_ppm: 60 })).toBe(0)
  })

  it('pairs with so4ClBand for a human verdict', () => {
    // Burton-on-Trent: SO4 610 / Cl 35 ≈ 17.4 → aggressively dry / hoppy
    const burton = so4ClRatio({ SO4_ppm: 610, Cl_ppm: 35 })
    expect(so4ClBand(burton).label).toMatch(/dry|hoppy/i)
    // NEIPA-ish chloride-forward water → very malty / round
    const hazy = so4ClRatio({ SO4_ppm: 50, Cl_ppm: 150 })
    expect(so4ClBand(hazy).label).toMatch(/malty/i)
  })
})
