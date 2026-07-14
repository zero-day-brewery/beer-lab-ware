/**
 * Additional infusion water to bump mash from one rest to the next.
 *   W = (T_target − T_initial) × (0.41 × grain_kg + V_initial) / (T_water − T_target)
 * Returns 0 if already at/above target or if water temp ≤ target.
 * Source: Palmer ch.15 "Infusion and Decoction Math".
 */
const GRAIN_HEAT_CAPACITY = 0.41

export interface InfusionInputs {
  grainMass_kg: number
  currentMashVolume_L: number
  currentTemp_C: number
  targetTemp_C: number
  infusionWaterTemp_C: number
}

export function calcInfusionWater(inputs: InfusionInputs): number {
  const { grainMass_kg, currentMashVolume_L, currentTemp_C, targetTemp_C, infusionWaterTemp_C } =
    inputs
  if (targetTemp_C <= currentTemp_C) return 0
  if (infusionWaterTemp_C <= targetTemp_C) return 0
  return (
    ((targetTemp_C - currentTemp_C) * (GRAIN_HEAT_CAPACITY * grainMass_kg + currentMashVolume_L)) /
    (infusionWaterTemp_C - targetTemp_C)
  )
}
