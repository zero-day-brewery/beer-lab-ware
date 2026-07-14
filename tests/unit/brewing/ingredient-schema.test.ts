import { describe, expect, it } from 'vitest'
import {
  type Fermentable,
  FermentableSchema,
  type Hop,
  IngredientAnySchema,
  IngredientSchema,
  type Yeast,
  YeastSchema,
} from '@/lib/brewing/types/ingredient'

const baseFermentable: Fermentable = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  kind: 'fermentable',
  name: '2-Row Pale',
  type: 'base',
  ppg: 37,
  color_L: 2,
  origin: 'US',
  supplier: 'Briess',
  maxInBatch_pct: 100,
  notes_md: '',
}

const baseHop: Hop = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  kind: 'hop',
  name: 'Cascade',
  alphaAcid_pct: 5.5,
  beta_pct: 6,
  type: 'dual',
  oils: { myrcene: 50, humulene: 12, caryophyllene: 5, farnesene: 6 },
  substitutes: ['Centennial', 'Amarillo'],
  origin: 'US',
  notes_md: '',
}

const baseYeast: Yeast = {
  id: '550e8400-e29b-41d4-a716-446655440003',
  kind: 'yeast',
  name: 'US-05',
  lab: 'Fermentis',
  productCode: 'US-05',
  type: 'ale',
  form: 'dry',
  attenuation_min_pct: 75,
  attenuation_max_pct: 82,
  flocculation: 'medium',
  temp_min_C: 15,
  temp_max_C: 22,
  esterProfile: 'clean',
  notes_md: '',
}

describe('IngredientSchema', () => {
  it('accepts a Fermentable', () => {
    expect(() => IngredientSchema.parse(baseFermentable)).not.toThrow()
  })

  it('accepts a Hop', () => {
    expect(() => IngredientSchema.parse(baseHop)).not.toThrow()
  })

  it('accepts a Yeast via IngredientAnySchema', () => {
    expect(() => IngredientAnySchema.parse(baseYeast)).not.toThrow()
  })

  it('rejects an unknown kind', () => {
    expect(() => IngredientSchema.parse({ ...baseHop, kind: 'unicorn' as 'hop' })).toThrow()
  })

  it('discriminates by kind — Fermentable without ppg fails', () => {
    expect(() => FermentableSchema.parse({ ...baseFermentable, ppg: undefined })).toThrow()
  })

  it('rejects yeast with attenuation_min_pct > attenuation_max_pct', () => {
    expect(() =>
      YeastSchema.parse({ ...baseYeast, attenuation_min_pct: 85, attenuation_max_pct: 80 }),
    ).toThrow()
  })
})
