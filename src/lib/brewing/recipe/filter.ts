import type { Recipe } from '@/lib/brewing/types/recipe'

export interface RecipeFilterCriteria {
  /** Free-text query — matched (case-insensitive) against name, styleId, and any tag. */
  search?: string
  /** Selected tag chips — a recipe must carry EVERY one of these (AND semantics). */
  tags?: string[]
}

/**
 * Pure recipe filter. A recipe is kept when BOTH hold:
 *  - every selected `tags` entry is present in `recipe.tags` (AND semantics; an
 *    empty selection matches everything);
 *  - the trimmed, lower-cased `search` is empty OR appears in the recipe `name`,
 *    `styleId`, or any of its tags.
 *
 * Never mutates the input. Recipes with no `tags` (legacy) behave as `[]`.
 */
export function filterRecipes(
  recipes: Recipe[],
  { search = '', tags = [] }: RecipeFilterCriteria = {},
): Recipe[] {
  const q = search.trim().toLowerCase()
  return recipes.filter((recipe) => {
    const recipeTags = recipe.tags ?? []
    // AND across selected tags — a recipe must carry all of them.
    if (!tags.every((t) => recipeTags.includes(t))) return false
    if (q === '') return true
    if (recipe.name.toLowerCase().includes(q)) return true
    if (recipe.styleId?.toLowerCase().includes(q)) return true
    return recipeTags.some((t) => t.toLowerCase().includes(q))
  })
}

/** Sorted, de-duplicated list of every tag used across the given recipes. */
export function allTags(recipes: Recipe[]): string[] {
  return [...new Set(recipes.flatMap((r) => r.tags ?? []))].sort()
}
