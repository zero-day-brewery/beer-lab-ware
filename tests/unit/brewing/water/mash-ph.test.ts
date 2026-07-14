import { describe, expect, it } from 'vitest'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { ZERO_PROFILE } from '@/lib/brewing/water/ions'
import { acidSuggestion, estimateMashPh } from '@/lib/brewing/water/mash-ph'

const ID = '550e8400-e29b-41d4-a716-446655440000'
function recipe(fermentables: Recipe['fermentables']): Recipe {
  return {
    id: ID,
    name: 'M',
    type: 'all-grain',
    batchSize_L: 20,
    boilTime_min: 60,
    equipmentProfileId: ID,
    fermentables,
    hops: [],
    yeasts: [],
    miscs: [],
    mashSteps: [],
    notes_md: '',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    schemaVersion: 1,
  }
}
const grain = (
  name: string,
  type: 'base' | 'specialty',
  ppg: number,
  color_L: number,
  kg: number,
) => ({
  ingredientId: ID,
  snapshot: { name, type, ppg, color_L },
  amount_kg: kg,
  usage: 'mash' as const,
  afterBoil: false,
})

describe('estimateMashPh', () => {
  it('pale-ale grist on RO water lands in a sane slightly-acidic band', () => {
    const r = recipe([grain('Pale 2-Row', 'base', 37, 2, 5)])
    const { ph } = estimateMashPh(r, ZERO_PROFILE, 20)
    expect(ph).toBeGreaterThan(5.3)
    expect(ph).toBeLessThan(5.7)
  })
  it('stout grist on RO is NOT absurdly low (roasted uses the gentler color coeff)', () => {
    const r = recipe([
      grain('Pale', 'base', 37, 2, 4),
      grain('Roast Barley', 'specialty', 25, 500, 0.5),
    ])
    const { ph, fracRoasted } = estimateMashPh(r, ZERO_PROFILE, 20)
    expect(fracRoasted).toBeGreaterThan(0.5)
    expect(ph).toBeGreaterThan(5.2)
    expect(ph).toBeLessThan(5.6)
  })
  it('alkaline water raises mash pH vs RO', () => {
    const r = recipe([grain('Pale 2-Row', 'base', 37, 2, 5)])
    const ro = estimateMashPh(r, ZERO_PROFILE, 20).ph
    const alk = estimateMashPh(r, { ...ZERO_PROFILE, Ca_ppm: 40, HCO3_ppm: 250 }, 20).ph
    expect(alk).toBeGreaterThan(ro)
  })
})

describe('acidSuggestion', () => {
  it('5 kg grist, 5.7 → 5.4 needs ~4.2 mL 88% lactic (~3% acid malt)', () => {
    const s = acidSuggestion(5.7, 5.4, 5)
    expect(s).not.toBeNull()
    expect(s?.lactic88_mL).toBeCloseTo(4.2, 1)
    expect(s?.acidMaltPct).toBeCloseTo(3.0, 0)
  })
  it('returns null when already at/below target', () => {
    expect(acidSuggestion(5.3, 5.4, 5)).toBeNull()
  })
})
