/**
 * Strike water temperature for a single-infusion mash.
 *   T_strike = (0.41 / R) × (T_target − T_grain) + T_target
 * where R is mash ratio in L/kg, all temperatures in °C.
 * Source: Palmer "How to Brew" 4e ch.15; Briess "Malt Handbook".
 */
const GRAIN_HEAT_CAPACITY = 0.41

export function calcStrikeTemp(
  targetTemp_C: number,
  grainTemp_C: number,
  mashRatio_LperKg: number,
): number {
  return (GRAIN_HEAT_CAPACITY / mashRatio_LperKg) * (targetTemp_C - grainTemp_C) + targetTemp_C
}
