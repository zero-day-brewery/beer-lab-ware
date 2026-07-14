import { describe, expect, it } from 'vitest'
import {
  alkalinityAsCaCO3,
  ra_dH,
  residualAlkalinity,
} from '@/lib/brewing/water/residual-alkalinity'

const w = { Ca_ppm: 50, Mg_ppm: 10, Na_ppm: 0, SO4_ppm: 0, Cl_ppm: 0, HCO3_ppm: 150 }

describe('residual alkalinity (Palmer ppm-as-CaCO3)', () => {
  it('HCO3 → alkalinity as CaCO3 (×0.8197)', () => {
    expect(alkalinityAsCaCO3(150)).toBeCloseTo(122.96, 1)
  })
  it('RA = Alk − (Ca/1.4 + Mg/1.7)', () => {
    expect(residualAlkalinity(w)).toBeCloseTo(81.36, 1)
  })
  it('RA in °dH = RA/17.86', () => {
    expect(ra_dH(w)).toBeCloseTo(4.556, 2)
  })
  it('pure RO water → RA 0', () => {
    expect(
      residualAlkalinity({ Ca_ppm: 0, Mg_ppm: 0, Na_ppm: 0, SO4_ppm: 0, Cl_ppm: 0, HCO3_ppm: 0 }),
    ).toBe(0)
  })
})
