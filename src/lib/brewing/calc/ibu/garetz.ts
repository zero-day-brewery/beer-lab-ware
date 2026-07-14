import { hopFormFactor } from '@/lib/brewing/calc/hop-form'
import type { HopUse } from '@/lib/brewing/types/recipe-parts'

/**
 * Garetz IBU (1994).
 *   U_pct = 7.2994 + 15.0746 × tanh((t − 21.86) / 24.71)
 *   GF = (OG − 1.050) / 0.2 + 1   (when OG > 1.050)
 *   IBU per addition = (g × alpha_pct × U_pct × form) / (vol_L × 10 × GF)   [metric]
 * `form` = per-form utilization multiplier (pellet/cryo ×1.10 vs whole 1.0);
 * see hop-form.ts. Applied to bittering additions only.
 * Source: Mark Garetz "Using Hops" (1994).
 */

const CONTRIBUTING_USES = new Set(['boil', 'first-wort', 'whirlpool'])

function garetzUtilization(time_min: number): number {
  return 7.2994 + 15.0746 * Math.tanh((time_min - 21.86) / 24.71)
}

export function calcIBUGaretz(
  hops: HopUse[],
  wortGravity: number,
  volume_L: number,
  hopUtilizationMultiplier: number,
): number {
  if (volume_L === 0) return 0
  const gf = wortGravity > 1.05 ? (wortGravity - 1.05) / 0.2 + 1 : 1
  let total = 0
  for (const h of hops) {
    if (!CONTRIBUTING_USES.has(h.use)) continue
    const uPct =
      garetzUtilization(h.time_min) * hopUtilizationMultiplier * hopFormFactor(h.snapshot.form)
    total += (h.amount_g * h.snapshot.alphaAcid_pct * uPct) / (volume_L * 10 * gf)
  }
  return total
}
