import { defaultMashRatio_LperKg } from '@/lib/brewing/mash/ratio'
import { calcStrikeTemp } from '@/lib/brewing/mash/strike'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { CalculationResult } from '@/lib/brewing/types/results'
import { calcABV } from './abv'
import { calcFG } from './attenuation'
import { calcOG } from './gravity'
import { calcIBU } from './ibu'
import { calcSRM } from './srm'
import { calcVolumes } from './volumes'

/**
 * Compose every brewing calculation into a single result.
 * Pure function — caller passes `now` as ISO timestamp.
 */
export function calculateRecipe(
  recipe: Recipe,
  equipment: EquipmentProfile,
  now: string,
): CalculationResult {
  const volumes = calcVolumes(recipe, equipment)
  const OG = calcOG(recipe, equipment)
  const FG = calcFG(recipe, OG)
  const ABV = calcABV(OG, FG, equipment.abvFormula)

  // Tinseth/Rager/Garetz are defined on the AVERAGE BOIL GRAVITY and the
  // POST-BOIL VOLUME, not OG and the into-fermenter volume. Gravity points are
  // conserved in the kettle, so wort is more dilute pre-boil:
  //   pre_boil_SG = 1 + OG_points × (post_boil_vol / pre_boil_vol) / 1000
  //   avg_boil_gravity = (pre_boil_SG + OG) / 2
  const ogPoints = (OG - 1) * 1000
  const preBoilGravity =
    volumes.preBoilVolume_L > 0
      ? 1 + (ogPoints * (volumes.postBoilVolume_L / volumes.preBoilVolume_L)) / 1000
      : OG
  const avgBoilGravity = (preBoilGravity + OG) / 2
  const IBU = calcIBU(
    recipe.hops,
    avgBoilGravity,
    volumes.postBoilVolume_L,
    equipment.hopUtilizationMultiplier,
    equipment.ibuFormula,
  )
  const SRM = calcSRM(recipe.fermentables, recipe.batchSize_L, equipment.srmFormula)

  // Strike temp from the recipe's ACTUAL mash thickness (mash water ÷ mashed
  // grain) and grain temperature — not a hardcoded 2.6 L/kg / 20 °C.
  const mashedGrainKg = recipe.fermentables
    .filter((f) => f.usage === 'mash')
    .reduce((acc, f) => acc + f.amount_kg, 0)
  const mashRatio_LperKg =
    mashedGrainKg > 0
      ? volumes.mashWater_L / mashedGrainKg
      : (recipe.mashThickness_LperKg ?? defaultMashRatio_LperKg)
  const grainTemp_C = recipe.grainTemp_C ?? 20
  const firstStep = recipe.mashSteps[0]
  const strikeTemp_C = firstStep
    ? calcStrikeTemp(firstStep.temperature_C, grainTemp_C, mashRatio_LperKg)
    : 0

  return {
    volumes,
    OG,
    FG,
    ABV,
    IBU,
    SRM,
    strikeTemp_C,
    formulasUsed: {
      ibu: equipment.ibuFormula,
      srm: equipment.srmFormula,
      abv: equipment.abvFormula,
    },
    computedAt: now,
    schemaVersion: 1,
  }
}
