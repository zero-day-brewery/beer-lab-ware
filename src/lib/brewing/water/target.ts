import type { IonProfile } from './ions'

export type WaterStyleKey =
  | 'light-hoppy'
  | 'neipa'
  | 'balanced'
  | 'amber-malty'
  | 'brown-malty'
  | 'dark-stout'
  | 'pale-lager'

const p = (
  Ca: number,
  Mg: number,
  Na: number,
  SO4: number,
  Cl: number,
  HCO3: number,
): IonProfile => ({
  Ca_ppm: Ca,
  Mg_ppm: Mg,
  Na_ppm: Na,
  SO4_ppm: SO4,
  Cl_ppm: Cl,
  HCO3_ppm: HCO3,
})

/** Finished-water targets by "water style". Sources: Bru'n Water, Palmer & Kaminski,
 *  The Electric Brewery, Brewer's Friend (cross-validated). */
export const TARGET_PROFILES: Record<WaterStyleKey, IonProfile> = {
  'light-hoppy': p(110, 18, 16, 275, 50, 0),
  neipa: p(100, 18, 16, 100, 200, 0),
  balanced: p(75, 12, 16, 100, 60, 40),
  'amber-malty': p(60, 10, 20, 70, 130, 90),
  'brown-malty': p(60, 10, 35, 60, 130, 125),
  'dark-stout': p(65, 10, 40, 50, 90, 200),
  'pale-lager': p(40, 6, 10, 50, 50, 15),
}

export function so4ClBand(ratio: number): { label: string } {
  if (ratio < 0.5) return { label: 'very malty / round' }
  if (ratio < 1.0) return { label: 'malt-leaning' }
  if (ratio < 2.0) return { label: 'balanced' }
  if (ratio <= 4.0) return { label: 'hop-forward / crisp' }
  return { label: 'aggressively dry / hoppy' }
}

/** SO₄:Cl mass ratio of a raw source-water profile. Cl = 0 → +Infinity, matching
 *  `computeAdditions()`'s `so4cl` convention. Pair with `so4ClBand()` for a label. */
export function so4ClRatio(w: { SO4_ppm: number; Cl_ppm: number }): number {
  return w.Cl_ppm > 0 ? w.SO4_ppm / w.Cl_ppm : Number.POSITIVE_INFINITY
}

/** Heuristic grid (overridable in the UI). Balance from BU:GU: >0.8 hoppy,
 *  0.5–0.8 balanced, <0.5 malty. NEIPA is reachable only via manual override. */
export function deriveWaterStyle(srm: number, buGu: number): WaterStyleKey {
  const malty = buGu < 0.5
  const hoppy = buGu > 0.8
  if (srm > 25) return 'dark-stout'
  if (srm >= 14) return malty ? 'brown-malty' : 'balanced'
  if (srm >= 8) return malty ? 'amber-malty' : 'balanced'
  if (hoppy) return 'light-hoppy'
  return malty ? 'pale-lager' : 'balanced'
}

export function targetForRecipe(
  srm: number,
  buGu: number,
): {
  styleKey: WaterStyleKey
  target: IonProfile
} {
  const styleKey = deriveWaterStyle(srm, buGu)
  return { styleKey, target: TARGET_PROFILES[styleKey] }
}
