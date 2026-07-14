import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Volumes } from '@/lib/brewing/types/results'

const DEFAULT_MASH_RATIO_LperKg = 2.6

/**
 * Compute the volume pipeline from grain bill + boil + equipment.
 *   strike → mash → post-mash → pre-boil → post-boil → post-chill → into-fermenter
 * Backs out from the target into-fermenter (batch) size.
 *
 * Source: Palmer "How to Brew" 4e ch.16; Kaiser water-volume notes.
 */
export function calcVolumes(recipe: Recipe, equipment: EquipmentProfile): Volumes {
  const mashedGrainKg = recipe.fermentables
    .filter((f) => f.usage === 'mash')
    .reduce((acc, f) => acc + f.amount_kg, 0)

  const grainAbsorbed_L = mashedGrainKg * equipment.grainAbsorption_LperKg
  // Mash water follows the recipe's chosen thickness when set, else the default.
  const mashRatio_LperKg = recipe.mashThickness_LperKg ?? DEFAULT_MASH_RATIO_LperKg
  const mashWater_L = mashedGrainKg * mashRatio_LperKg

  const intoFermenter_L = recipe.batchSize_L
  const postChill_L = intoFermenter_L + equipment.kettleDeadSpace_L
  // Clamp shrinkage to [0, 99]% so a bad profile can never divide by zero
  // (≥100% would yield Infinity / negative volumes downstream).
  const shrinkFraction = Math.min(Math.max(equipment.coolingShrinkage_pct, 0), 99) / 100
  const postBoilVolume_L = postChill_L / (1 - shrinkFraction)
  const evaporated_L = equipment.evaporationRate_LperHr * (recipe.boilTime_min / 60)
  const preBoilVolume_L = postBoilVolume_L + evaporated_L - equipment.topUpKettle_L
  const spargeWater_L = Math.max(
    0,
    preBoilVolume_L + grainAbsorbed_L + equipment.mashTunDeadSpace_L - mashWater_L,
  )

  return {
    mashWater_L,
    spargeWater_L,
    preBoilVolume_L,
    postBoilVolume_L,
    intoFermenter_L,
  }
}
