import { describe, expect, it } from 'vitest'
import { calcFG } from '@/lib/brewing/calc/attenuation'
import type { Recipe } from '@/lib/brewing/types/recipe'

const baseRecipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'Test',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [],
  hops: [],
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
  mashSteps: [],
  notes_md: '',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  schemaVersion: 1,
}

describe('calcFG', () => {
  it('uses midpoint of attenuation range (78.5%)', () => {
    // OG 1.052, 78.5% → FG = 1 + 0.052 × 0.215 = 1.0112
    expect(calcFG(baseRecipe, 1.052)).toBeCloseTo(1.0112, 3)
  })

  it('uses attenuationOverride when present', () => {
    const r: Recipe = {
      ...baseRecipe,
      yeasts: [{ ...baseRecipe.yeasts[0], attenuationOverride_pct: 90 }],
    }
    // OG 1.052, 90% → FG = 1 + 0.052 × 0.10 = 1.0052
    expect(calcFG(r, 1.052)).toBeCloseTo(1.0052, 3)
  })

  it('returns OG when no yeast specified', () => {
    expect(calcFG({ ...baseRecipe, yeasts: [] }, 1.05)).toBeCloseTo(1.05, 4)
  })

  it('uses first yeast when multiple are listed', () => {
    const r: Recipe = {
      ...baseRecipe,
      yeasts: [
        baseRecipe.yeasts[0],
        {
          ingredientId: '550e8400-e29b-41d4-a716-446655440302',
          snapshot: {
            name: 'Other',
            attenuation_min_pct: 60,
            attenuation_max_pct: 65,
            form: 'liquid',
          },
          amount: 1,
        },
      ],
    }
    expect(calcFG(r, 1.052)).toBeCloseTo(1.0112, 3)
  })
})
