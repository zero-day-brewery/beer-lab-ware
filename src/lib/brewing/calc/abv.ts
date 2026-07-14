import type { ABVFormula } from '@/lib/brewing/types/equipment'

/**
 * ABV from OG and FG.
 *   simple   = (OG − FG) × 131.25
 *   advanced = (76.08 × (OG − FG) / (1.775 − OG)) × (FG / 0.794)
 *
 * Simple is the homebrew rule of thumb (±0.1% under 1.060). Advanced is the
 * high-gravity correction; it tracks measured ABV better when OG is high, but
 * its own published accuracy note recommends OG < ~1.070 for best results.
 *
 * Source: Hall, "Brew by the Numbers," Zymurgy 18(4) (1995); AHA technical
 * brewing reference. (Previously mis-attributed to Daniels "Designing Great
 * Beers" — the advanced formula originates with Hall's Zymurgy article.)
 */
export function calcABV(OG: number, FG: number, formula: ABVFormula): number {
  if (FG >= OG) return 0

  if (formula === 'simple') {
    return (OG - FG) * 131.25
  }

  return ((76.08 * (OG - FG)) / (1.775 - OG)) * (FG / 0.794)
}
