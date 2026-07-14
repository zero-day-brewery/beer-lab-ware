import { describe, expect, it } from 'vitest'
import {
  type FermentableUse,
  FermentableUseSchema,
  type HopUse,
  HopUseSchema,
  type MashStep,
  MashStepSchema,
} from '@/lib/brewing/types/recipe-parts'

describe('recipe-parts schemas', () => {
  it('accepts a valid MashStep (infusion)', () => {
    const step: MashStep = {
      name: 'Saccharification',
      type: 'infusion',
      temperature_C: 66,
      time_min: 60,
    }
    expect(() => MashStepSchema.parse(step)).not.toThrow()
  })

  it('rejects MashStep with negative time', () => {
    expect(() =>
      MashStepSchema.parse({
        name: 'Bad',
        type: 'infusion',
        temperature_C: 66,
        time_min: -1,
      }),
    ).toThrow()
  })

  it('accepts a valid FermentableUse with snapshot fields', () => {
    const use: FermentableUse = {
      ingredientId: '550e8400-e29b-41d4-a716-446655440100',
      snapshot: { name: '2-Row Pale', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    }
    expect(() => FermentableUseSchema.parse(use)).not.toThrow()
  })

  it('accepts a valid HopUse with snapshot fields', () => {
    const use: HopUse = {
      ingredientId: '550e8400-e29b-41d4-a716-446655440200',
      snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
      amount_g: 28,
      time_min: 60,
      use: 'boil',
    }
    expect(() => HopUseSchema.parse(use)).not.toThrow()
  })

  it('rejects HopUse with negative amount', () => {
    expect(() =>
      HopUseSchema.parse({
        ingredientId: '550e8400-e29b-41d4-a716-446655440200',
        snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
        amount_g: -1,
        time_min: 60,
        use: 'boil',
      }),
    ).toThrow()
  })

  it('accepts the optional 2b inventoryItemId remembered link on a use', () => {
    const use: FermentableUse = {
      ingredientId: '550e8400-e29b-41d4-a716-446655440100',
      snapshot: { name: '2-Row Pale', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
      inventoryItemId: '550e8400-e29b-41d4-a716-4466554400aa',
    }
    const parsed = FermentableUseSchema.parse(use)
    expect(parsed.inventoryItemId).toBe('550e8400-e29b-41d4-a716-4466554400aa')
  })

  it('parses a legacy use with no inventoryItemId (additive/optional)', () => {
    const use = {
      ingredientId: '550e8400-e29b-41d4-a716-446655440200',
      snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
      amount_g: 28,
      time_min: 60,
      use: 'boil',
    }
    const parsed = HopUseSchema.parse(use)
    expect(parsed.inventoryItemId).toBeUndefined()
  })

  it('rejects a non-uuid inventoryItemId', () => {
    expect(() =>
      HopUseSchema.parse({
        ingredientId: '550e8400-e29b-41d4-a716-446655440200',
        snapshot: { name: 'Cascade', alphaAcid_pct: 5.5, form: 'pellet' },
        amount_g: 28,
        time_min: 60,
        use: 'boil',
        inventoryItemId: 'not-a-uuid',
      }),
    ).toThrow()
  })
})
