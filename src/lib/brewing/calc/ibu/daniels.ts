import { hopFormFactor } from '@/lib/brewing/calc/hop-form'
import type { HopUse } from '@/lib/brewing/types/recipe-parts'

/**
 * Daniels IBU — piecewise utilization table approximation.
 *   t (min)   U_pct
 *   ≤0        0
 *   ≤5        5
 *   ≤10      12
 *   ≤15      15
 *   ≤20      19
 *   ≤25      22
 *   ≤30      24
 *   ≤35      27
 *   ≤40      28
 *   ≤60      30
 *   else     30
 * Hop form: per-form utilization multiplier (pellet/cryo ×1.10 vs whole 1.0) —
 * see hop-form.ts. This is the same ×1.10 pellet bonus Daniels documents; it now
 * also covers cryo and stays consistent with the other IBU models.
 * Source: Ray Daniels "Designing Great Beers" (1996) ch.6.
 */

const CONTRIBUTING_USES = new Set(['boil', 'first-wort', 'whirlpool'])

function danielsUtilization(time_min: number): number {
  if (time_min <= 0) return 0
  if (time_min <= 5) return 5
  if (time_min <= 10) return 12
  if (time_min <= 15) return 15
  if (time_min <= 20) return 19
  if (time_min <= 25) return 22
  if (time_min <= 30) return 24
  if (time_min <= 35) return 27
  if (time_min <= 40) return 28
  if (time_min <= 60) return 30
  return 30
}

export function calcIBUDaniels(
  hops: HopUse[],
  _wortGravity: number,
  volume_L: number,
  hopUtilizationMultiplier: number,
): number {
  if (volume_L === 0) return 0
  let total = 0
  for (const h of hops) {
    if (!CONTRIBUTING_USES.has(h.use)) continue
    const uPct =
      danielsUtilization(h.time_min) * hopUtilizationMultiplier * hopFormFactor(h.snapshot.form)
    total += (h.amount_g * h.snapshot.alphaAcid_pct * uPct) / (volume_L * 10)
  }
  return total
}
