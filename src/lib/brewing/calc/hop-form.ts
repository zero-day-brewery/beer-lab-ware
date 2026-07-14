import type { HopUse } from '@/lib/brewing/types/recipe-parts'

/**
 * Per-form hop utilization multiplier for bittering (IBU) calculations.
 *
 * Pelletized hops are milled and pressed, which ruptures the lupulin glands and
 * exposes the alpha acids directly to the wort. The same alpha / weight / boil
 * time therefore isomerizes MORE alpha acid than intact whole cones, yielding
 * ~10% higher utilization. Cryo / lupulin pellets share the same broken-gland
 * mechanism, so they get the same bonus. Whole leaf and plugs (compressed whole
 * cones) keep their lupulin glands intact → baseline 1.0. CO2 extract is modeled
 * as neutral here (its true behavior differs, but it is added as isomerized-alpha
 * differently in practice; 1.0 keeps it from silently inflating IBU).
 *
 *   leaf / plug / extract   1.00  (baseline — intact lupulin)
 *   pellet / cryo           1.10  (+10% — ruptured lupulin glands)
 *
 * Sources:
 *   - Ray Daniels, "Designing Great Beers" (1996), ch.6 — pellet ×1.10 factor.
 *   - John Palmer, "How to Brew" 4e, ch.15 — pellets ~10% more efficient.
 *   - BeerSmith hop utilization / "hop factor" default (pellet vs whole).
 *
 * Missing / undefined form defaults to 1.0 (whole) so malformed or legacy hop
 * uses can never silently inflate IBU. (The HopSnapshot schema requires `form`,
 * so validated recipes always specify it; the default only guards raw input.)
 * This also matches the app's prior Daniels behavior (`form === 'pellet' ? 1.1 : 1.0`).
 */

export type HopForm = HopUse['snapshot']['form']

const FORM_FACTORS: Record<HopForm, number> = {
  leaf: 1.0,
  plug: 1.0,
  extract: 1.0,
  pellet: 1.1,
  cryo: 1.1,
}

/** Pure utilization multiplier for a hop form. Undefined/unknown → 1.0 (whole). */
export function hopFormFactor(form: HopForm | undefined): number {
  if (form === undefined) return 1.0
  return FORM_FACTORS[form] ?? 1.0
}
