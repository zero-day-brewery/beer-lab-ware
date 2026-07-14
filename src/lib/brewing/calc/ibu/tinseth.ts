import { hopFormFactor } from '@/lib/brewing/calc/hop-form'
import type { HopUse } from '@/lib/brewing/types/recipe-parts'

/**
 * Tinseth IBU.
 *   U(t, G) = 1.65 × 0.000125^(G - 1) × (1 - e^(-0.04 × t)) / 4.15
 *   IBU per addition = (alpha_pct × hop_g × U × form × 10) / volume_L
 *
 * `form` is the per-form utilization multiplier (pellet/cryo ×1.10 vs
 * whole/leaf 1.0) — see hop-form.ts. Only bittering additions get it.
 *
 * Boil / first-wort / whirlpool hops contribute; dry-hop / mash / aroma = 0.
 *
 * Source: Glenn Tinseth (1995) "Hop Utilization Modelling"
 *         http://realbeer.com/hops/research.html
 */
export function tinsethUtilization(time_min: number, wortGravity: number): number {
  return (1.65 * 0.000125 ** (wortGravity - 1) * (1 - Math.exp(-0.04 * time_min))) / 4.15
}

const CONTRIBUTING_USES = new Set(['boil', 'first-wort', 'whirlpool'])

export function calcIBUTinseth(
  hops: HopUse[],
  wortGravity: number,
  volume_L: number,
  hopUtilizationMultiplier: number,
): number {
  if (volume_L === 0) return 0

  let total = 0
  for (const h of hops) {
    if (!CONTRIBUTING_USES.has(h.use)) continue
    const u =
      tinsethUtilization(h.time_min, wortGravity) *
      hopUtilizationMultiplier *
      hopFormFactor(h.snapshot.form)
    total += (h.snapshot.alphaAcid_pct * h.amount_g * u * 10) / volume_L
  }
  return total
}
