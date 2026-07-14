import { hopFormFactor } from '@/lib/brewing/calc/hop-form'
import type { HopUse } from '@/lib/brewing/types/recipe-parts'

/**
 * Rager IBU (1990).
 *   U_pct = 18.11 + 13.86 × tanh((t − 31.32) / 18.27)
 *   GA    = (OG − 1.050) / 0.2     (when OG > 1.050)
 *   U_eff = U_pct / (1 + GA)
 *   IBU per addition = (g × alpha_pct × U_eff × form) / (vol_L × 10)   [metric]
 * `form` = per-form utilization multiplier (pellet/cryo ×1.10 vs whole 1.0);
 * see hop-form.ts. Applied to bittering additions only.
 * Source: Jackie Rager (1990) Zymurgy "Calculating Hop Bitterness".
 */

const CONTRIBUTING_USES = new Set(['boil', 'first-wort', 'whirlpool'])

function ragerUtilization(time_min: number, OG: number): number {
  const uPct = 18.11 + 13.86 * Math.tanh((time_min - 31.32) / 18.27)
  if (OG <= 1.05) return uPct
  const ga = (OG - 1.05) / 0.2
  return uPct / (1 + ga)
}

export function calcIBURager(
  hops: HopUse[],
  wortGravity: number,
  volume_L: number,
  hopUtilizationMultiplier: number,
): number {
  if (volume_L === 0) return 0
  let total = 0
  for (const h of hops) {
    if (!CONTRIBUTING_USES.has(h.use)) continue
    const uPct =
      ragerUtilization(h.time_min, wortGravity) *
      hopUtilizationMultiplier *
      hopFormFactor(h.snapshot.form)
    total += (h.amount_g * h.snapshot.alphaAcid_pct * uPct) / (volume_L * 10)
  }
  return total
}
