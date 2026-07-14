/**
 * Yeast-lot viability — pure, portable brewing logic (no DOM/Dexie/fetch).
 *
 * Companion to `inventory/freshness.ts`, which models liquid-yeast viability for
 * a fungible `InventoryItem` (97% − 0.7%/day). This module models it per **lot**
 * and **per form**, because a dry sachet, a liquid pack and a harvested slurry
 * age at very different rates. Same lineage of sources.
 *
 * ── Decline curves (linear %/day from `productionDate`, clamped 0–100) ────────
 *  - liquid  97% start, −0.7%/day  (~21%/month). Zainasheff & White, "Yeast"
 *            (2010); Mr. Malty pitch-rate viability model. Matches freshness.ts.
 *  - dry     98% start, −0.02%/day (~0.6%/month). Dry yeast is far more stable —
 *            refrigerated sachets stay usable ~2 years. Conservative flat curve
 *            (Fermentis/Lallemand storage guidance).
 *  - slurry  90% start, −1.3%/day. Harvested slurry starts lower (non-sterile,
 *            variable) and declines fastest; use within ~1–2 weeks. Homebrew
 *            harvest-and-repitch practice (Zainasheff & White, ch. on harvesting).
 *
 * All numbers are estimates — the UI must label them "est."
 */

import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

const MS_PER_DAY = 86_400_000

interface DeclineModel {
  startPct: number
  lossPctPerDay: number
}

/** Per-form linear decline models (documented constants, not magic numbers). */
const DECLINE_BY_FORM: Record<YeastLot['form'], DeclineModel> = {
  liquid: { startPct: 97, lossPctPerDay: 0.7 },
  dry: { startPct: 98, lossPctPerDay: 0.02 },
  slurry: { startPct: 90, lossPctPerDay: 1.3 },
}

/** Days elapsed from a lot's production/harvest date to `now` (may be negative). */
function ageDays(lot: YeastLot, now: Date): number {
  return (now.getTime() - new Date(lot.productionDate).getTime()) / MS_PER_DAY
}

/**
 * Estimated current viability of a lot, as a percentage 0–100, using its
 * form-specific decline curve from `productionDate`. UI must label it "est."
 */
export function currentViability(lot: YeastLot, now: Date = new Date()): number {
  const { startPct, lossPctPerDay } = DECLINE_BY_FORM[lot.form]
  const raw = startPct - lossPctPerDay * ageDays(lot, now)
  return Math.max(0, Math.min(100, raw))
}

/**
 * Estimated live cells remaining in a lot, in billions:
 * `initialCells_B × currentViability%`.
 */
export function viableCells(lot: YeastLot, now: Date = new Date()): number {
  return lot.initialCells_B * (currentViability(lot, now) / 100)
}
