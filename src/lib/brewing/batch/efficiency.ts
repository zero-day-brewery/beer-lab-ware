import { kgToLb } from '@/lib/brewing/convert/mass'
import { lToGal } from '@/lib/brewing/convert/volume'
import type { Recipe } from '@/lib/brewing/types/recipe'

/**
 * Brewhouse efficiency from a MEASURED OG — the true inverse of calcOG.
 *
 * calcOG applies brewhouse efficiency ONLY to mashed fermentables (usage
 * 'mash' | 'sparge') and gives 100% yield to sugar / extract (all other
 * non-excluded usages). To be the true inverse, this function must mirror
 * that split:
 *
 *   max mash potential  = Σ(weightLb × ppg)  [mash/sparge only]
 *   extract/sugar points= Σ(weightLb × ppg)  [boil/firstwort/non-mash, not excluded]
 *
 *   collected points    = (measuredOG − 1) × 1000 × intoFermenter_gal
 *   mash-only collected = collected − extract/sugar points  (100%-yield contribution removed)
 *   efficiency %        = mash-only collected / max mash potential × 100
 *
 * Bottling / fermenter / afterBoil fermentables are excluded (they are not in
 * the boil and never contribute to OG), matching calcOG's filter.
 *
 * Source: Palmer "How to Brew" 4e ch.7; Daniels "Designing Great Beers" ch.4.
 */
export function calcBrewhouseEfficiency(i: {
  measuredOG: number
  intoFermenter_L: number
  fermentables: Recipe['fermentables']
}): number {
  const gal = lToGal(i.intoFermenter_L)
  if (gal <= 0) return 0

  let maxMashPoints = 0
  let extractSugarPoints = 0

  for (const f of i.fermentables) {
    // Mirror calcOG exclusions exactly
    if (f.usage === 'bottling' || f.usage === 'fermenter' || f.afterBoil) continue
    const pts = kgToLb(f.amount_kg) * f.snapshot.ppg
    const isMashed = f.usage === 'mash' || f.usage === 'sparge'
    if (isMashed) {
      maxMashPoints += pts
    } else {
      // sugar / extract: 100%-yield in calcOG; subtract their contribution from collected
      extractSugarPoints += pts
    }
  }

  if (maxMashPoints <= 0) return 0

  const collectedPoints = (i.measuredOG - 1) * 1000 * gal
  // Remove the fixed extract/sugar contribution to isolate what came from mashing
  const mashCollected = collectedPoints - extractSugarPoints
  if (mashCollected <= 0) return 0

  return (mashCollected / maxMashPoints) * 100
}

/**
 * Apparent degree of fermentation (ADF) from OG and FG, in percent.
 *   ADF% = (og_points − fg_points) / og_points × 100
 * Pure replacement for the store-layer attenuation() helper.
 *
 * Source: Palmer 4e; ASBC.
 */
export function apparentAttenuationPct(og: number, fg: number): number {
  const ogPts = (og - 1) * 1000
  if (ogPts <= 0) return 0
  const fgPts = (fg - 1) * 1000
  if (fgPts >= ogPts) return 0
  return ((ogPts - fgPts) / ogPts) * 100
}
