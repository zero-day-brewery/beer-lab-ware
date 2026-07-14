import { describe, expect, it } from 'vitest'
import { calcABV } from '@/lib/brewing/calc/abv'

describe('calcABV', () => {
  it('simple: 1.052 → 1.012 = 5.25%', () => {
    expect(calcABV(1.052, 1.012, 'simple')).toBeCloseTo(5.25, 2)
  })

  it('simple: 1.060 → 1.014 = 6.04%', () => {
    expect(calcABV(1.06, 1.014, 'simple')).toBeCloseTo(6.04, 2)
  })

  it('advanced: 1.052 → 1.012 ≈ same as simple at low gravity', () => {
    const simple = calcABV(1.052, 1.012, 'simple')
    const advanced = calcABV(1.052, 1.012, 'advanced')
    expect(Math.abs(simple - advanced)).toBeLessThan(0.3)
  })

  it('advanced: 1.100 → 1.018 (RIS) is higher than simple result', () => {
    const simple = calcABV(1.1, 1.018, 'simple')
    const advanced = calcABV(1.1, 1.018, 'advanced')
    expect(advanced).toBeGreaterThan(simple)
  })

  it('returns 0 when FG >= OG', () => {
    expect(calcABV(1.04, 1.04, 'simple')).toBe(0)
    expect(calcABV(1.04, 1.05, 'simple')).toBe(0)
  })
})
