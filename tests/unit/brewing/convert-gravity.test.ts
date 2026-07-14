import { describe, expect, it } from 'vitest'
import { brixToSG, platoToSG, roundSG, sgToBrix, sgToPlato } from '@/lib/brewing/convert/gravity'
import { correctedFG } from '@/lib/brewing/convert/refractometer'

describe('roundSG (gravity display precision)', () => {
  it('rounds to 3 decimal places', () => {
    expect(roundSG(1.0104694532)).toBe(1.01)
    expect(roundSG(1.0125)).toBe(1.013)
    expect(roundSG(1.0)).toBe(1)
  })

  it('is a no-op on values already at 3 decimals', () => {
    expect(roundSG(1.048)).toBe(1.048)
  })

  it('matches what the refractometer displays (toFixed(3)) — no spurious precision applied', () => {
    // regression: refractometer "Use" used to apply the raw float 1.010469453233282
    const rawFg = correctedFG(1.06, brixToSG(6.5))
    expect(roundSG(rawFg)).toBe(Number(rawFg.toFixed(3)))
  })
})

describe('gravity conversions', () => {
  it('SG ↔ Plato', () => {
    expect(platoToSG(12)).toBeCloseTo(1.0483, 3)
    expect(sgToPlato(1.0483)).toBeCloseTo(12, 1)
  })

  it('SG ↔ Brix (close to Plato but distinct)', () => {
    expect(brixToSG(12)).toBeCloseTo(1.0483, 3)
    expect(sgToBrix(1.0483)).toBeCloseTo(12, 1)
  })

  it('SG 1.000 = 0°P', () => {
    expect(sgToPlato(1.0)).toBeCloseTo(0, 1)
    expect(platoToSG(0)).toBeCloseTo(1.0, 4)
  })
})

describe('refractometer correction (Sean Terrill)', () => {
  it('returns SG unchanged when fermentation has not started', () => {
    const og = 1.05
    expect(correctedFG(og, og)).toBeCloseTo(og, 4)
  })

  it('corrects a known fermenting wort', () => {
    const og = 1.052
    const fgRefracReadAsSG = 1.0235
    const fg = correctedFG(og, fgRefracReadAsSG)
    expect(fg).toBeGreaterThan(1.005)
    expect(fg).toBeLessThan(1.02)
  })
})
