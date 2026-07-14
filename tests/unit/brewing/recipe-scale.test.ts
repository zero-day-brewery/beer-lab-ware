import { describe, expect, it } from 'vitest'
import { calcOG } from '@/lib/brewing/calc/gravity'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import { scaleRecipe, scaleToOG, withFreshTargets } from '@/lib/brewing/recipe/scale'
import type { Recipe } from '@/lib/brewing/types/recipe'

const ID = '550e8400-e29b-41d4-a716-446655440000'
const base: Recipe = {
  id: ID,
  name: 'Test IPA',
  type: 'all-grain',
  batchSize_L: 20,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: ID,
      snapshot: { name: 'Pale', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [
    {
      ingredientId: ID,
      snapshot: { name: 'Citra', alphaAcid_pct: 12, form: 'pellet' },
      amount_g: 30,
      time_min: 60,
      use: 'boil',
    },
  ],
  yeasts: [
    {
      ingredientId: ID,
      snapshot: { name: 'US-05', attenuation_min_pct: 75, attenuation_max_pct: 80, form: 'dry' },
      amount: 1,
    },
  ],
  miscs: [
    {
      ingredientId: ID,
      snapshot: { name: 'Whirlfloc', type: 'fining' },
      amount: 5,
      amountUnit: 'g',
      use: 'boil',
      time_min: 15,
    },
  ],
  mashSteps: [
    { name: 'Sacch', type: 'infusion', temperature_C: 66, time_min: 60, waterAmount_L: 13 },
  ],
  notes_md: '',
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
  schemaVersion: 1,
}

describe('scaleRecipe', () => {
  it('scales ingredient amounts linearly with batch size', () => {
    const out = scaleRecipe(base, 40)
    expect(out.batchSize_L).toBe(40)
    expect(out.fermentables[0].amount_kg).toBeCloseTo(8)
    expect(out.hops[0].amount_g).toBeCloseTo(60)
    expect(out.miscs[0].amount).toBeCloseTo(10)
    expect(out.mashSteps[0].waterAmount_L).toBeCloseTo(26)
  })

  it('does NOT scale yeast amount or mash temperatures', () => {
    const out = scaleRecipe(base, 40)
    expect(out.yeasts[0].amount).toBe(1)
    expect(out.mashSteps[0].temperature_C).toBe(66)
  })

  it('returns a new recipe and never mutates the original', () => {
    const out = scaleRecipe(base, 40)
    expect(out.id).not.toBe(base.id)
    expect(out.name).toBe('Test IPA (40 L)')
    expect(base.fermentables[0].amount_kg).toBe(4)
    expect(base.batchSize_L).toBe(20)
  })

  it('formats non-integer sizes to one decimal in the name', () => {
    expect(scaleRecipe(base, 18.5).name).toBe('Test IPA (18.5 L)')
  })

  it('throws on non-positive size', () => {
    expect(() => scaleRecipe(base, 0)).toThrow()
  })

  it('carries tags through to the scaled recipe (independent array)', () => {
    const tagged: Recipe = { ...base, tags: ['ipa', 'house'] }
    const out = scaleRecipe(tagged, 40)
    expect(out.tags).toEqual(['ipa', 'house'])
    expect(out.tags).not.toBe(tagged.tags)
  })
})

describe('scaleToOG', () => {
  const equip = B40PRO_PROFILE

  it('hits a HIGHER target OG within ~0.001', () => {
    const out = scaleToOG(base, equip, 1.06)
    expect(calcOG(out, equip)).toBeCloseTo(1.06, 3)
  })

  it('hits a LOWER target OG within ~0.001', () => {
    const out = scaleToOG(base, equip, 1.03)
    expect(calcOG(out, equip)).toBeCloseTo(1.03, 3)
  })

  it('scales the grain bill up/down and leaves batch size + hops alone', () => {
    const current = calcOG(base, equip)
    const factor = ((1.06 - 1) * 1000) / ((current - 1) * 1000)
    const out = scaleToOG(base, equip, 1.06)
    expect(out.batchSize_L).toBe(base.batchSize_L)
    expect(out.fermentables[0].amount_kg).toBeCloseTo(base.fermentables[0].amount_kg * factor, 6)
    expect(out.hops[0].amount_g).toBe(base.hops[0].amount_g)
    expect(out.miscs[0].amount).toBe(base.miscs[0].amount)
    expect(out.mashSteps[0].waterAmount_L).toBe(base.mashSteps[0].waterAmount_L)
  })

  it('returns a new id + "(OG …)" name and never mutates the original', () => {
    const out = scaleToOG(base, equip, 1.055)
    expect(out.id).not.toBe(base.id)
    expect(out.name).toBe('Test IPA (OG 1.055)')
    expect(base.fermentables[0].amount_kg).toBe(4)
    expect(base.batchSize_L).toBe(20)
    expect(base.name).toBe('Test IPA')
  })

  it('throws when the recipe has no gravity-contributing fermentables', () => {
    const noGrain: Recipe = { ...base, fermentables: [] }
    expect(() => scaleToOG(noGrain, equip, 1.05)).toThrow()
  })
})

describe('withFreshTargets', () => {
  const equip = B40PRO_PROFILE
  const now = '2026-07-05T00:00:00.000Z'

  it('overwrites targets with the calc pipeline output', () => {
    // Start from a recipe with STALE targets to prove they get replaced.
    const stale: Recipe = { ...base, targets: { OG: 1.001, IBU: 1, SRM: 1 } }
    const calc = calculateRecipe(stale, equip, now)
    const out = withFreshTargets(stale, equip, now)
    expect(out.targets).toEqual({
      OG: calc.OG,
      FG: calc.FG,
      ABV: calc.ABV,
      IBU: calc.IBU,
      SRM: calc.SRM,
    })
  })

  it('is pure — does not mutate the input recipe', () => {
    const input: Recipe = { ...base, targets: { OG: 1.001 } }
    withFreshTargets(input, equip, now)
    expect(input.targets).toEqual({ OG: 1.001 })
  })
})
