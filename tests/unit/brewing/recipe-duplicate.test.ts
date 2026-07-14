import { describe, expect, it } from 'vitest'
import { duplicateRecipe } from '@/lib/brewing/recipe/duplicate'
import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'

const ID = '550e8400-e29b-41d4-a716-446655440000'
const NEW_ID = '550e8400-e29b-41d4-a716-4466554400ff'
const NOW = '2026-07-05T12:00:00.000Z'

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
  targets: { OG: 1.05, IBU: 45 },
  notes_md: 'house pale',
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-24T00:00:00.000Z',
  schemaVersion: 1,
}

describe('duplicateRecipe', () => {
  it('assigns the provided new id (different from the original)', () => {
    const copy = duplicateRecipe(base, { id: NEW_ID, now: NOW })
    expect(copy.id).toBe(NEW_ID)
    expect(copy.id).not.toBe(base.id)
  })

  it('appends " (copy)" to the name', () => {
    const copy = duplicateRecipe(base, { id: NEW_ID, now: NOW })
    expect(copy.name).toBe('Test IPA (copy)')
  })

  it('stamps a fresh createdAt and updatedAt equal to `now`', () => {
    const copy = duplicateRecipe(base, { id: NEW_ID, now: NOW })
    expect(copy.createdAt).toBe(NOW)
    expect(copy.updatedAt).toBe(NOW)
    // Passes the RecipeSchema `updatedAt >= createdAt` refinement.
    expect(new Date(copy.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(copy.createdAt).getTime(),
    )
  })

  it('carries over equipmentProfileId, targets, and schemaVersion', () => {
    const copy = duplicateRecipe(base, { id: NEW_ID, now: NOW })
    expect(copy.equipmentProfileId).toBe(base.equipmentProfileId)
    expect(copy.targets).toEqual(base.targets)
    expect(copy.schemaVersion).toBe(1)
    expect(copy.type).toBe(base.type)
    expect(copy.batchSize_L).toBe(base.batchSize_L)
  })

  it('produces a RecipeSchema-valid recipe', () => {
    const copy = duplicateRecipe(base, { id: NEW_ID, now: NOW })
    expect(() => RecipeSchema.parse(copy)).not.toThrow()
  })

  it('deep-clones arrays — mutating the copy does not affect the original', () => {
    const copy = duplicateRecipe(base, { id: NEW_ID, now: NOW })

    // The array references are independent.
    expect(copy.fermentables).not.toBe(base.fermentables)
    expect(copy.hops).not.toBe(base.hops)
    expect(copy.yeasts).not.toBe(base.yeasts)
    expect(copy.miscs).not.toBe(base.miscs)
    expect(copy.mashSteps).not.toBe(base.mashSteps)

    // Mutate scalar, nested-object, and array-length in the copy.
    copy.fermentables[0].amount_kg = 999
    copy.fermentables[0].snapshot.name = 'MUTATED'
    copy.hops[0].amount_g = 1
    copy.mashSteps.push({ name: 'Mashout', type: 'infusion', temperature_C: 76, time_min: 10 })
    if (copy.targets) copy.targets.OG = 1.2

    // Original is untouched.
    expect(base.fermentables[0].amount_kg).toBe(4)
    expect(base.fermentables[0].snapshot.name).toBe('Pale')
    expect(base.hops[0].amount_g).toBe(30)
    expect(base.mashSteps).toHaveLength(1)
    expect(base.targets?.OG).toBe(1.05)
  })

  it('never mutates the original recipe (id/name/timestamps preserved)', () => {
    duplicateRecipe(base, { id: NEW_ID, now: NOW })
    expect(base.id).toBe(ID)
    expect(base.name).toBe('Test IPA')
    expect(base.createdAt).toBe('2026-06-23T00:00:00.000Z')
    expect(base.updatedAt).toBe('2026-06-24T00:00:00.000Z')
  })

  it('carries tags through to the copy (independent array)', () => {
    const tagged: Recipe = { ...base, tags: ['ipa', 'house'] }
    const copy = duplicateRecipe(tagged, { id: NEW_ID, now: NOW })
    expect(copy.tags).toEqual(['ipa', 'house'])
    // Deep-cloned — mutating the copy's tags never touches the original.
    expect(copy.tags).not.toBe(tagged.tags)
    copy.tags?.push('MUTATED')
    expect(tagged.tags).toEqual(['ipa', 'house'])
  })
})
