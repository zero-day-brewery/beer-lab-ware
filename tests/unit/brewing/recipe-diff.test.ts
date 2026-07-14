import { describe, expect, it } from 'vitest'
import { diffRecipes } from '@/lib/brewing/recipe/diff'
import type { Recipe } from '@/lib/brewing/types/recipe'

const ID = '550e8400-e29b-41d4-a716-446655440000'
const FERM = '550e8400-e29b-41d4-a716-446655440001'
const HOP = '550e8400-e29b-41d4-a716-446655440002'
const YEAST = '550e8400-e29b-41d4-a716-446655440003'
const MISC = '550e8400-e29b-41d4-a716-446655440004'

function makeRecipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: ID,
    name: 'Test IPA',
    type: 'all-grain',
    batchSize_L: 20,
    boilTime_min: 60,
    equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
    fermentables: [
      {
        ingredientId: FERM,
        snapshot: { name: 'Pale', type: 'base', ppg: 37, color_L: 2 },
        amount_kg: 5,
        usage: 'mash',
        afterBoil: false,
      },
    ],
    hops: [
      {
        ingredientId: HOP,
        snapshot: { name: 'Citra', alphaAcid_pct: 12, form: 'pellet' },
        amount_g: 30,
        time_min: 60,
        use: 'boil',
      },
    ],
    yeasts: [
      {
        ingredientId: YEAST,
        snapshot: { name: 'US-05', attenuation_min_pct: 75, attenuation_max_pct: 80, form: 'dry' },
        amount: 1,
      },
    ],
    miscs: [
      {
        ingredientId: MISC,
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
    targets: { OG: 1.05, FG: 1.01, ABV: 5.2, IBU: 40, SRM: 6 },
    notes_md: '',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

describe('diffRecipes — scalar fields', () => {
  it('identical recipes → isEmpty', () => {
    const d = diffRecipes(makeRecipe(), makeRecipe())
    expect(d.isEmpty).toBe(true)
    expect(d.fields).toHaveLength(0)
    expect(d.ingredients).toHaveLength(0)
  })

  it('batch-size change emits exactly one field line', () => {
    const d = diffRecipes(makeRecipe(), makeRecipe({ batchSize_L: 22 }))
    expect(d.fields).toEqual([{ label: 'Batch size', from: 20, to: 22 }])
    expect(d.ingredients).toHaveLength(0)
    expect(d.isEmpty).toBe(false)
  })

  it('boil-time change emits exactly one field line', () => {
    const d = diffRecipes(makeRecipe(), makeRecipe({ boilTime_min: 90 }))
    expect(d.fields).toEqual([{ label: 'Boil time', from: 60, to: 90 }])
  })

  it('each vital-stat target change emits its own line', () => {
    const d = diffRecipes(
      makeRecipe(),
      makeRecipe({ targets: { OG: 1.06, FG: 1.01, ABV: 5.2, IBU: 40, SRM: 6 } }),
    )
    expect(d.fields).toEqual([{ label: 'OG', from: 1.05, to: 1.06 }])
  })

  it('multiple target changes each produce a line', () => {
    const d = diffRecipes(
      makeRecipe(),
      makeRecipe({ targets: { OG: 1.06, FG: 1.012, ABV: 5.9, IBU: 55, SRM: 8 } }),
    )
    expect(d.fields.map((f) => f.label)).toEqual(['OG', 'FG', 'ABV', 'IBU', 'SRM'])
  })

  it('treats an added/removed targets block as a change', () => {
    const withT = makeRecipe()
    const noT = makeRecipe({ targets: undefined })
    const d = diffRecipes(noT, withT)
    expect(d.fields.map((f) => f.label)).toEqual(['OG', 'FG', 'ABV', 'IBU', 'SRM'])
    expect(d.fields[0]).toEqual({ label: 'OG', from: undefined, to: 1.05 })
  })
})

describe('diffRecipes — ingredients', () => {
  it('detects a removed fermentable, keyed correctly', () => {
    const d = diffRecipes(makeRecipe(), makeRecipe({ fermentables: [] }))
    expect(d.ingredients).toEqual([
      {
        kind: 'fermentable',
        key: `${FERM}:Pale`,
        name: 'Pale',
        change: 'removed',
        from: '5.000 kg',
      },
    ])
  })

  it('detects an added fermentable, keyed correctly', () => {
    const added = makeRecipe({
      fermentables: [
        ...makeRecipe().fermentables,
        {
          ingredientId: '550e8400-e29b-41d4-a716-446655440099',
          snapshot: { name: 'Munich', type: 'specialty', ppg: 35, color_L: 9 },
          amount_kg: 1,
          usage: 'mash',
          afterBoil: false,
        },
      ],
    })
    const d = diffRecipes(makeRecipe(), added)
    expect(d.ingredients).toEqual([
      {
        kind: 'fermentable',
        key: '550e8400-e29b-41d4-a716-446655440099:Munich',
        name: 'Munich',
        change: 'added',
        to: '1.000 kg',
      },
    ])
  })

  it('detects a fermentable amount change', () => {
    const bumped = makeRecipe({
      fermentables: [{ ...makeRecipe().fermentables[0], amount_kg: 5.5 }],
    })
    const d = diffRecipes(makeRecipe(), bumped)
    expect(d.ingredients).toEqual([
      {
        kind: 'fermentable',
        key: `${FERM}:Pale`,
        name: 'Pale',
        change: 'amount',
        from: '5.000 kg',
        to: '5.500 kg',
      },
    ])
  })

  it('float epsilon: 5.000 vs 5.0004 is not a change', () => {
    const nudged = makeRecipe({
      fermentables: [{ ...makeRecipe().fermentables[0], amount_kg: 5.0004 }],
    })
    const d = diffRecipes(makeRecipe(), nudged)
    expect(d.isEmpty).toBe(true)
  })

  it('detects a hop amount change', () => {
    const bumped = makeRecipe({ hops: [{ ...makeRecipe().hops[0], amount_g: 45 }] })
    const d = diffRecipes(makeRecipe(), bumped)
    expect(d.ingredients).toEqual([
      {
        kind: 'hop',
        key: `${HOP}:Citra`,
        name: 'Citra',
        change: 'amount',
        from: '30.000 g @ 60 min',
        to: '45.000 g @ 60 min',
      },
    ])
  })

  it('detects a hop time_min change (same amount)', () => {
    const rehop = makeRecipe({ hops: [{ ...makeRecipe().hops[0], time_min: 20 }] })
    const d = diffRecipes(makeRecipe(), rehop)
    expect(d.ingredients).toHaveLength(1)
    expect(d.ingredients[0]).toMatchObject({
      kind: 'hop',
      change: 'amount',
      from: '30.000 g @ 60 min',
      to: '30.000 g @ 20 min',
    })
  })

  it('detects a yeast added/removed', () => {
    const d = diffRecipes(makeRecipe(), makeRecipe({ yeasts: [] }))
    expect(d.ingredients).toEqual([
      { kind: 'yeast', key: `${YEAST}:US-05`, name: 'US-05', change: 'removed', from: '1.000' },
    ])
  })

  it('detects a misc amount + unit change', () => {
    const changed = makeRecipe({
      miscs: [{ ...makeRecipe().miscs[0], amount: 10, amountUnit: 'ml' }],
    })
    const d = diffRecipes(makeRecipe(), changed)
    expect(d.ingredients).toEqual([
      {
        kind: 'misc',
        key: `${MISC}:Whirlfloc`,
        name: 'Whirlfloc',
        change: 'amount',
        from: '5.000 g',
        to: '10.000 ml',
      },
    ])
  })

  it('groups changes across kinds into one diff', () => {
    const many = makeRecipe({
      batchSize_L: 25,
      fermentables: [],
      hops: [{ ...makeRecipe().hops[0], amount_g: 50 }],
    })
    const d = diffRecipes(makeRecipe(), many)
    expect(d.fields).toEqual([{ label: 'Batch size', from: 20, to: 25 }])
    expect(d.ingredients.map((c) => [c.kind, c.change])).toEqual([
      ['fermentable', 'removed'],
      ['hop', 'amount'],
    ])
    expect(d.isEmpty).toBe(false)
  })
})
