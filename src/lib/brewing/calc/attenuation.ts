import type { Recipe } from '@/lib/brewing/types/recipe'

/**
 * FG from OG + yeast attenuation.
 *   FG = 1 + (OG - 1) × (1 - attenuation_fraction)
 * Uses first yeast (matches common brewing-software behavior). attenuationOverride_pct wins
 * over snapshot range midpoint.
 * Source: Daniels ch.5; Palmer ch.8.
 */
export function calcFG(recipe: Recipe, OG: number): number {
  const yeast = recipe.yeasts[0]
  if (!yeast) return OG

  const attenuationPct =
    yeast.attenuationOverride_pct ??
    (yeast.snapshot.attenuation_min_pct + yeast.snapshot.attenuation_max_pct) / 2

  return 1 + (OG - 1) * (1 - attenuationPct / 100)
}
