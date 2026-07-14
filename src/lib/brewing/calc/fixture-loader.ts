import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type EquipmentProfile, EquipmentProfileSchema } from '@/lib/brewing/types/equipment'
import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'

export interface ExpectedResult {
  OG: number
  FG: number
  ABV: number
  IBU: number
  SRM: number
  volumes?: {
    preBoilVolume_L?: number
    postBoilVolume_L?: number
    intoFermenter_L?: number
  }
  strikeTemp_C?: number
}

export interface LoadedFixture {
  recipe: Recipe
  equipment: EquipmentProfile
  expected: ExpectedResult
}

/**
 * Load a reference fixture:
 *   recipe.json    — Recipe schema
 *   equipment.json — EquipmentProfile schema
 *   expected.json  — ExpectedResult
 */
export function loadFixture(fixtureDir: string): LoadedFixture {
  const recipe = RecipeSchema.parse(
    JSON.parse(readFileSync(join(fixtureDir, 'recipe.json'), 'utf-8')),
  )
  const equipment = EquipmentProfileSchema.parse(
    JSON.parse(readFileSync(join(fixtureDir, 'equipment.json'), 'utf-8')),
  )
  const expected = JSON.parse(
    readFileSync(join(fixtureDir, 'expected.json'), 'utf-8'),
  ) as ExpectedResult
  return { recipe, equipment, expected }
}
