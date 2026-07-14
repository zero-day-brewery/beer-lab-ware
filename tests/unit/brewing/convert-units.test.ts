import { describe, expect, it } from 'vitest'
import { gToOz, kgToLb, lbToKg, ozToG } from '@/lib/brewing/convert/mass'
import { cToF, fToC } from '@/lib/brewing/convert/temp'
import { galToL, lToGal, lToMl, mlToL } from '@/lib/brewing/convert/volume'

describe('volume conversions', () => {
  it('L ↔ gal round-trips', () => {
    expect(galToL(1)).toBeCloseTo(3.78541, 4)
    expect(lToGal(3.78541)).toBeCloseTo(1, 4)
  })
  it('L ↔ mL', () => {
    expect(lToMl(1)).toBe(1000)
    expect(mlToL(500)).toBe(0.5)
  })
})

describe('mass conversions', () => {
  it('kg ↔ lb round-trips', () => {
    expect(lbToKg(1)).toBeCloseTo(0.453592, 5)
    expect(kgToLb(1)).toBeCloseTo(2.20462, 4)
  })
  it('g ↔ oz round-trips', () => {
    expect(ozToG(1)).toBeCloseTo(28.3495, 3)
    expect(gToOz(28.3495)).toBeCloseTo(1, 3)
  })
})

describe('temperature conversions', () => {
  it('C ↔ F round-trips', () => {
    expect(cToF(0)).toBe(32)
    expect(cToF(100)).toBe(212)
    expect(fToC(32)).toBe(0)
    expect(fToC(212)).toBe(100)
    expect(cToF(66)).toBeCloseTo(150.8, 1)
  })
})
