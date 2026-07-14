import { kgToLb } from '@/lib/brewing/convert/mass'
import { lToGal } from '@/lib/brewing/convert/volume'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'

/**
 * OG from grain bill, efficiency, and batch volume.
 *   OG_points = Σ(weight_lb × PPG × efficiency) / batch_gal
 *   OG        = 1 + OG_points / 1000
 *
 * Mashed fermentables apply brewhouse efficiency; sugar/extract get 100%.
 *
 * Original Gravity is the gravity of the wort at PITCH time (post-boil/chill,
 * pre-fermentation), so packaging and post-boil additions are excluded:
 *   - `bottling` (priming sugar)        → carbonation only, never part of OG
 *   - `fermenter` / `afterBoil`         → not present when OG is measured
 * Including them would inflate the reported OG (and therefore ABV).
 *
 * Source: Palmer "How to Brew" 4e ch.7; Daniels "Designing Great Beers" ch.4.
 */
export function calcOG(recipe: Recipe, equipment: EquipmentProfile): number {
  const batchGal = lToGal(recipe.batchSize_L)
  if (batchGal === 0) return 1.0

  const eff = equipment.brewhouseEfficiency_pct / 100

  let totalPoints = 0
  for (const f of recipe.fermentables) {
    if (f.usage === 'bottling' || f.usage === 'fermenter' || f.afterBoil) continue
    const weightLb = kgToLb(f.amount_kg)
    const isMashed = f.usage === 'mash' || f.usage === 'sparge'
    const efficiency = isMashed ? eff : 1.0
    totalPoints += weightLb * f.snapshot.ppg * efficiency
  }

  return 1 + totalPoints / batchGal / 1000
}
