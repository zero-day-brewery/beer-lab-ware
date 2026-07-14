/**
 * FIFO-viable yeast-lot selection — pure, portable (no DOM/Dexie/fetch).
 *
 * Resolves "use FIFO, but pitch it while it's most viable" into one rule: pitch
 * the **oldest lot that still clears a viability floor** (FIFO *within* the
 * still-viable set), and when even the chosen lot is short on live cells,
 * recommend a **starter** rather than silently under-pitch. If nothing clears
 * the floor, say so — never pick a dead lot.
 *
 * Required cells come from the pitch-rate engine (`pitch/pitch-rate.ts`); this
 * module only decides *which lot* and *whether a starter is needed*.
 */

import { currentViability, viableCells } from '@/lib/brewing/inventory/yeast-viability'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { isInStock } from '@/lib/brewing/types/yeast-lot'

/**
 * Viability floor for a *direct* pitch. Below this a lot is treated as needing a
 * starter / replacement rather than a straight pour. 50% is the common homebrew
 * cutoff (Mr. Malty / "Yeast", Zainasheff & White) — old liquid yeast under
 * ~50% viability wants a starter to build a healthy pitch. Documented constant.
 */
export const VIABILITY_FLOOR_PCT = 50

export type YeastAction = 'pitch' | 'pitch-with-starter' | 'make-starter-or-buy'

export interface RankedLot {
  lot: YeastLot
  viabilityPct: number
  viableCells_B: number
}

export interface YeastSelectionInput {
  strain: string
  /** Cells the batch needs, in billions (from calcPitchRate). */
  requiredCells_B: number
  lots: YeastLot[]
  now?: Date
  /** Override the floor for testing / preference. */
  viabilityFloorPct?: number
}

export interface YeastSelection {
  strain: string
  requiredCells_B: number
  /** The FIFO-viable pick, or null when no in-stock lot clears the floor. */
  chosen: YeastLot | null
  chosenViabilityPct: number | null
  chosenViableCells_B: number | null
  action: YeastAction
  starterRecommended: boolean
  /** Cells short of the requirement (0 when the pick covers it). */
  cellDeficit_B: number
  reason: string
  /** In-stock lots that clear the floor, in FIFO order (oldest first). */
  viableRanked: RankedLot[]
}

/** Ascending by production date (oldest first) — the FIFO order. */
function byOldest(a: YeastLot, b: YeastLot): number {
  return new Date(a.productionDate).getTime() - new Date(b.productionDate).getTime()
}

export function selectYeastLot(input: YeastSelectionInput): YeastSelection {
  const now = input.now ?? new Date()
  const floor = input.viabilityFloorPct ?? VIABILITY_FLOOR_PCT
  const target = input.strain.trim().toLowerCase()

  const inStockMatches = input.lots
    .filter(isInStock)
    .filter((l) => l.strain.trim().toLowerCase() === target)

  const viableRanked: RankedLot[] = inStockMatches
    .map((lot) => ({
      lot,
      viabilityPct: currentViability(lot, now),
      viableCells_B: viableCells(lot, now),
    }))
    .filter((r) => r.viabilityPct >= floor)
    .sort((a, b) => byOldest(a.lot, b.lot))

  if (viableRanked.length === 0) {
    return {
      strain: input.strain,
      requiredCells_B: input.requiredCells_B,
      chosen: null,
      chosenViabilityPct: null,
      chosenViableCells_B: null,
      action: 'make-starter-or-buy',
      starterRecommended: true,
      cellDeficit_B: input.requiredCells_B,
      reason:
        inStockMatches.length > 0
          ? `No in-stock ${input.strain} lot is above ${floor}% viability — build a starter or buy fresh.`
          : `No ${input.strain} in stock — buy or harvest a lot.`,
      viableRanked: [],
    }
  }

  const pick = viableRanked[0] // oldest viable = FIFO-within-viable
  const deficit = Math.max(0, input.requiredCells_B - pick.viableCells_B)
  const short = deficit > 0
  return {
    strain: input.strain,
    requiredCells_B: input.requiredCells_B,
    chosen: pick.lot,
    chosenViabilityPct: pick.viabilityPct,
    chosenViableCells_B: pick.viableCells_B,
    action: short ? 'pitch-with-starter' : 'pitch',
    starterRecommended: short,
    cellDeficit_B: deficit,
    reason: short
      ? `Oldest viable lot (${pick.viabilityPct.toFixed(0)}% est.) gives ~${pick.viableCells_B.toFixed(0)} B of ~${input.requiredCells_B.toFixed(0)} B needed — build a starter.`
      : `Pitch the oldest viable lot (${pick.viabilityPct.toFixed(0)}% est., ~${pick.viableCells_B.toFixed(0)} B cells).`,
    viableRanked,
  }
}
