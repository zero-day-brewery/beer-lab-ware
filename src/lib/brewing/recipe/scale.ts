import { calcOG } from '@/lib/brewing/calc/gravity'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { newId } from '@/lib/utils/id'

/**
 * Scale a recipe to a new batch size. Quantity fields (fermentable/hop/misc
 * amounts and per-step mash water) scale linearly by the volume ratio. Yeast
 * `amount` (an attenuation knob in this model, not a real pitch quantity), mash
 * temperatures, mash thickness, grain temp and boil time are NOT scaled. Volumes
 * and strike water derive from batchSize at calc time, so they follow
 * automatically. Returns a NEW recipe; the original is never mutated.
 */
export function scaleRecipe(recipe: Recipe, newBatchSize_L: number): Recipe {
  if (newBatchSize_L <= 0) throw new Error('newBatchSize_L must be positive')
  const r = newBatchSize_L / recipe.batchSize_L
  const now = new Date().toISOString()
  const clone = structuredClone(recipe)
  return {
    ...clone,
    id: newId(),
    name: `${recipe.name} (${formatSize(newBatchSize_L)} L)`,
    batchSize_L: newBatchSize_L,
    fermentables: clone.fermentables.map((f) => ({ ...f, amount_kg: f.amount_kg * r })),
    hops: clone.hops.map((h) => ({ ...h, amount_g: h.amount_g * r })),
    miscs: clone.miscs.map((m) => ({ ...m, amount: m.amount * r })),
    mashSteps: clone.mashSteps.map((s) => ({
      ...s,
      waterAmount_L: s.waterAmount_L != null ? s.waterAmount_L * r : s.waterAmount_L,
    })),
    createdAt: now,
    updatedAt: now,
  }
}

function formatSize(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * Scale a recipe's grain bill to hit a target original gravity, at a FIXED
 * batch size. `calcOG` is linear in the grain bill (Σ weight × PPG × efficiency
 * / volume), so the required grain multiplier is simply
 * `targetPoints / currentPoints`, where `points = (SG − 1) × 1000`. Only
 * `fermentables[].amount_kg` changes — batch size, hops, miscs, mash water and
 * yeast are left alone. Returns a NEW recipe; the original is never mutated.
 *
 * Throws when the recipe has no gravity-contributing fermentables (current OG
 * points ≤ 0): there is nothing to scale toward a target.
 */
export function scaleToOG(recipe: Recipe, equipment: EquipmentProfile, targetOG: number): Recipe {
  const currentPoints = (calcOG(recipe, equipment) - 1) * 1000
  if (currentPoints <= 0) {
    throw new Error('Cannot scale to a target OG: recipe has no fermentables to scale')
  }
  const factor = ((targetOG - 1) * 1000) / currentPoints
  const now = new Date().toISOString()
  const clone = structuredClone(recipe)
  return {
    ...clone,
    id: newId(),
    name: `${recipe.name} (OG ${targetOG.toFixed(3)})`,
    fermentables: clone.fermentables.map((f) => ({ ...f, amount_kg: f.amount_kg * factor })),
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Return a copy of the recipe with its `targets` overwritten by the values the
 * calc pipeline derives right now (OG/FG/ABV/IBU/SRM). A scaled recipe's copied
 * targets would otherwise be stale; applied before save so the new recipe's
 * printed targets match its actual composition. Pure — the input is not mutated.
 */
export function withFreshTargets(recipe: Recipe, equipment: EquipmentProfile, now: string): Recipe {
  const calc = calculateRecipe(recipe, equipment, now)
  return {
    ...recipe,
    targets: { OG: calc.OG, FG: calc.FG, ABV: calc.ABV, IBU: calc.IBU, SRM: calc.SRM },
  }
}
