import { describe, expect, it } from 'vitest'

import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'

const minRecipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH Pale Ale',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  styleId: '21A',
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
      snapshot: { name: '2-Row Pale', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440201',
      snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
      amount_g: 28,
      time_min: 60,
      use: 'boil',
    },
  ],
  yeasts: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440301',
      snapshot: {
        name: 'US-05',
        attenuation_min_pct: 75,
        attenuation_max_pct: 82,
        form: 'dry',
      },
      amount: 11.5,
    },
  ],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: 'First SMaSH batch on the B40 Pro.',
  createdAt: '2026-05-11T12:00:00.000Z',
  updatedAt: '2026-05-11T12:00:00.000Z',
  schemaVersion: 1,
}

describe('RecipeSchema', () => {
  it('accepts a minimal valid recipe', () => {
    expect(() => RecipeSchema.parse(minRecipe)).not.toThrow()
  })

  it('rejects negative batchSize_L', () => {
    expect(() => RecipeSchema.parse({ ...minRecipe, batchSize_L: -1 })).toThrow()
  })

  it('rejects unknown recipe type', () => {
    expect(() => RecipeSchema.parse({ ...minRecipe, type: 'sake' as 'all-grain' })).toThrow()
  })

  it('accepts optional targets', () => {
    const withTargets: Recipe = {
      ...minRecipe,
      targets: { OG: 1.052, FG: 1.012, ABV: 5.2, IBU: 38, SRM: 6.5 },
    }
    expect(() => RecipeSchema.parse(withTargets)).not.toThrow()
  })

  it('rejects updatedAt before createdAt', () => {
    expect(() =>
      RecipeSchema.parse({
        ...minRecipe,
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      }),
    ).toThrow()
  })

  it('accepts optional tags', () => {
    const withTags: Recipe = { ...minRecipe, tags: ['ipa', 'house'] }
    const parsed = RecipeSchema.parse(withTags)
    expect(parsed.tags).toEqual(['ipa', 'house'])
  })

  it('parses a legacy recipe with no tags key (additive, no migration)', () => {
    const legacy = { ...minRecipe }
    // Ensure there is genuinely no `tags` property on the object.
    expect('tags' in legacy).toBe(false)
    const parsed = RecipeSchema.parse(legacy)
    expect(parsed.tags).toBeUndefined()
  })

  it('rejects non-string tag entries', () => {
    expect(() => RecipeSchema.parse({ ...minRecipe, tags: [1, 2] })).toThrow()
  })
})
