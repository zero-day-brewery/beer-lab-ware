import type { Recipe } from '@/lib/brewing/types/recipe'

export interface DuplicateOptions {
  /** New unique id for the copy (uuid). */
  id: string
  /** ISO-8601 timestamp used for BOTH createdAt and updatedAt on the copy. */
  now: string
}

/**
 * Duplicate a recipe. Returns a NEW recipe that is a deep, independent clone of
 * `recipe`: a fresh id, a `"<name> (copy)"` name, and matching created/updated
 * timestamps. The ingredient/step arrays (fermentables, hops, yeasts, miscs,
 * mashSteps) plus `targets` are deep-cloned via `structuredClone`, so mutating
 * the copy never touches the original. `equipmentProfileId`, `targets`,
 * `schemaVersion`, and every other design field carry over unchanged.
 *
 * Pure: the input is never mutated, and the result satisfies `RecipeSchema`
 * (`updatedAt === createdAt`, so the `updatedAt >= createdAt` refinement holds).
 */
export function duplicateRecipe(recipe: Recipe, { id, now }: DuplicateOptions): Recipe {
  const clone = structuredClone(recipe)
  return {
    ...clone,
    id,
    name: `${recipe.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  }
}
