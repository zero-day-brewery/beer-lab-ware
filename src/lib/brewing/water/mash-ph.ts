import { calcSRMMorey } from '@/lib/brewing/calc/srm/morey'
import { kgToLb } from '@/lib/brewing/convert/mass'
import { lToGal } from '@/lib/brewing/convert/volume'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { IonProfile } from './ions'
import { ra_dH } from './residual-alkalinity'

const ROAST_THRESHOLD_L = 300

export interface MashPhResult {
  ph: number
  pHDistilled: number
  ra_dH: number
  srmBeer: number
  fracRoasted: number
}

/**
 * Estimated mash pH — Troester/braukaiser color + Residual-Alkalinity model.
 * Uses only data the app has (malt amount, color, type) — NO per-malt titration.
 * Accuracy ±0.1–0.2 pH (room temp ~20–25 °C). `treatedWater` is the POST-additions
 * profile. Sources: braukaiser.com, EZ Water / Brewer's Friend.
 */
export function estimateMashPh(
  recipe: Recipe,
  treatedWater: IonProfile,
  batchVolume_L: number,
): MashPhResult {
  const mashGrains = recipe.fermentables.filter(
    (f) => f.usage === 'mash' && f.snapshot.type !== 'sugar' && f.snapshot.type !== 'extract',
  )
  const gal = lToGal(batchVolume_L) || 1
  let mcu = 0
  let colorRoasted = 0
  let colorTotal = 0
  for (const f of mashGrains) {
    const contribution = kgToLb(f.amount_kg) * f.snapshot.color_L // lb·°L
    mcu += contribution / gal
    colorTotal += contribution
    if (f.snapshot.color_L > ROAST_THRESHOLD_L) colorRoasted += contribution
  }
  const srmBeer = calcSRMMorey(mcu)
  const fracRoasted = colorTotal > 0 ? colorRoasted / colorTotal : 0
  const fracNon = 1 - fracRoasted
  const pHDistilled = 5.6 - (srmBeer * (0.21 * fracNon + 0.06 * fracRoasted)) / 12
  const radh = ra_dH(treatedWater)
  const ph = pHDistilled + 0.02 * radh
  return { ph, pHDistilled, ra_dH: radh, srmBeer, fracRoasted }
}

export interface AcidSuggestion {
  lactic88_mL: number
  acidMalt_g: number
  acidMaltPct: number
}

/**
 * Acid to lower mash pH to target. Simple Kolbach mass form:
 *   0.28 mL of 88% lactic per kg grist per 0.1 pH (≈ 35 mEq/kg buffering ÷ 11.7 mEq/mL).
 * Acid malt modeled at 3% lactic (per-brand varies 2–4.5%). Returns null if no acid needed.
 */
export function acidSuggestion(
  currentPh: number,
  targetPh: number,
  gristKg: number,
): AcidSuggestion | null {
  if (currentPh <= targetPh || gristKg <= 0) return null
  const dPh = currentPh - targetPh
  const lactic88_mL = 0.28 * gristKg * (dPh / 0.1)
  const acidMalt_g = lactic88_mL / 0.0284 // 1 g 3% acid malt ≈ 0.0284 mL of 88% lactic
  const acidMaltPct = (acidMalt_g / (gristKg * 1000)) * 100
  return { lactic88_mL, acidMalt_g, acidMaltPct }
}
