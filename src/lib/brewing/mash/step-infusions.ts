import type { Recipe } from '@/lib/brewing/types/recipe'
import { calcInfusionWater } from './infusion'

export interface StepInfusion {
  stepIndex: number
  water_L: number | null
}

export interface StepInfusionOpts {
  strikeVolume_L: number
  grainMass_kg: number
  infusionWaterTemp_C?: number
}

/**
 * Per-step boiling-water additions for a multi-step infusion mash, composing the
 * existing single-step `calcInfusionWater`. Step 0 is the strike (null). Only
 * `infusion`-type steps after the first get a volume; `temperature`/`decoction`
 * steps return null and add no water to the running volume.
 */
export function calcStepInfusions(
  recipe: Recipe,
  { strikeVolume_L, grainMass_kg, infusionWaterTemp_C = 100 }: StepInfusionOpts,
): StepInfusion[] {
  let currentVolume_L = strikeVolume_L
  return recipe.mashSteps.map((step, i) => {
    if (i === 0) return { stepIndex: 0, water_L: null }
    if (step.type !== 'infusion') return { stepIndex: i, water_L: null }
    const prev = recipe.mashSteps[i - 1]
    const water_L = calcInfusionWater({
      grainMass_kg,
      currentMashVolume_L: currentVolume_L,
      currentTemp_C: prev.temperature_C,
      targetTemp_C: step.temperature_C,
      infusionWaterTemp_C,
    })
    currentVolume_L += water_L
    return { stepIndex: i, water_L }
  })
}
