import { describe, expect, it } from 'vitest'
import { ION_BAR_FIELDS, type IonBearing, ionBarScale } from '@/lib/brewing/water/ion-bars'

const w = (
  Ca: number,
  Mg: number,
  Na: number,
  SO4: number,
  Cl: number,
  HCO3: number,
): IonBearing => ({
  Ca_ppm: Ca,
  Mg_ppm: Mg,
  Na_ppm: Na,
  SO4_ppm: SO4,
  Cl_ppm: Cl,
  HCO3_ppm: HCO3,
})

// The 7 seeded presets (src/lib/brewing/defaults/water-profiles.ts).
const RO = w(0, 0, 0, 0, 0, 0)
const soft = w(25, 5, 10, 25, 20, 30)
const balanced = w(60, 8, 20, 60, 50, 80)
const pilsen = w(7, 2, 2, 5, 5, 15)
const burton = w(275, 40, 25, 610, 35, 270)
const dublin = w(118, 4, 12, 55, 19, 280)
const london = w(100, 4, 15, 80, 60, 165)
const SEVEN = [RO, soft, balanced, pilsen, burton, dublin, london]

describe('ionBarScale', () => {
  it('takes the SHARED max per ion across all profiles', () => {
    const { max } = ionBarScale(SEVEN)
    expect(max.Ca_ppm).toBe(275) // Burton
    expect(max.Mg_ppm).toBe(40) // Burton
    expect(max.Na_ppm).toBe(25) // Burton
    expect(max.SO4_ppm).toBe(610) // Burton
    expect(max.Cl_ppm).toBe(60) // London
    expect(max.HCO3_ppm).toBe(280) // Dublin
  })

  it('expresses each profile as a fraction in [0,1] of the shared max', () => {
    const { fractions } = ionBarScale(SEVEN)
    // Burton owns the Ca/SO₄ maxes → fraction 1 for those ions.
    const b = fractions[4]
    expect(b.Ca_ppm).toBe(1)
    expect(b.SO4_ppm).toBe(1)
    // London owns Cl → 1; its SO₄ is 80/610.
    expect(fractions[6].Cl_ppm).toBe(1)
    expect(fractions[6].SO4_ppm).toBeCloseTo(80 / 610, 10)
    // Every fraction stays within [0,1].
    for (const row of fractions) {
      for (const field of ION_BAR_FIELDS) {
        expect(row[field]).toBeGreaterThanOrEqual(0)
        expect(row[field]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('gives RO / distilled (all-zero) an empty bar for every ion', () => {
    const roFraction = ionBarScale(SEVEN).fractions[0]
    for (const field of ION_BAR_FIELDS) {
      expect(roFraction[field]).toBe(0)
    }
  })

  it('yields max 0 and fraction 0 when every profile reads zero for an ion', () => {
    // No profile has any HCO₃ here → that ion collapses to an empty bar for all.
    const noHco3 = [w(50, 0, 0, 40, 30, 0), w(80, 0, 0, 60, 90, 0)]
    const { max, fractions } = ionBarScale(noHco3)
    expect(max.HCO3_ppm).toBe(0)
    expect(fractions[0].HCO3_ppm).toBe(0)
    expect(fractions[1].HCO3_ppm).toBe(0)
    // Cl still scales: 30 and 90 against a max of 90.
    expect(fractions[0].Cl_ppm).toBeCloseTo(30 / 90, 10)
    expect(fractions[1].Cl_ppm).toBe(1)
  })

  it('makes a single profile its own max → every non-zero ion is a full bar', () => {
    const { max, fractions } = ionBarScale([balanced])
    expect(max.Ca_ppm).toBe(60)
    expect(fractions).toHaveLength(1)
    expect(fractions[0].Ca_ppm).toBe(1)
    expect(fractions[0].SO4_ppm).toBe(1)
    expect(fractions[0].Cl_ppm).toBe(1)
  })

  it('returns zeroed maxes and no rows for an empty profile list', () => {
    const { max, fractions } = ionBarScale([])
    expect(fractions).toEqual([])
    for (const field of ION_BAR_FIELDS) {
      expect(max[field]).toBe(0)
    }
  })

  it('clamps negatives / non-finite inputs to an empty bar', () => {
    const dirty = w(-10, Number.NaN, 5, 100, 50, 20)
    const { max, fractions } = ionBarScale([dirty, w(20, 10, 5, 100, 50, 20)])
    // Negative Ca is ignored for the max (20 wins) and clamps to 0 for the row.
    expect(max.Ca_ppm).toBe(20)
    expect(fractions[0].Ca_ppm).toBe(0)
    // NaN never becomes the max and produces a 0 fraction (NaN/10 clamps to 0).
    expect(max.Mg_ppm).toBe(10)
    expect(fractions[0].Mg_ppm).toBe(0)
  })
})
