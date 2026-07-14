// Pure harvest planner: given a parent lot + slurry volume, estimate the child lot's
// viable-cell count and produce a gen+1 draft. Guards the zero-cell case so a harvest
// from a dead parent can never save an invalid (0-cell) lot.
import { VIABILITY_FLOOR_PCT } from '@/lib/brewing/inventory/yeast-selection'
import { currentViability } from '@/lib/brewing/inventory/yeast-viability'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

/** Billion cells per mL of thick, settled ale slurry. Typical homebrew estimate
 *  (~1.0–1.5 B/mL for a well-flocculated ale slurry); mid-range default. */
export const SLURRY_CELLS_PER_ML_B = 1.2
export const GENERATION_WARN_AT = 5
export const MIN_LOT_CELLS_B = 0.1

export type YeastLotDraft = Omit<YeastLot, 'id' | 'createdAt' | 'updatedAt'>
export interface HarvestInput {
  parentLot: YeastLot
  slurryVolume_mL: number
  harvestDate: string /* full ISO datetime */
  batchId?: string
  now?: Date
}
export interface HarvestPlan {
  draft: YeastLotDraft
  estimatedCells_B: number
  canSave: boolean
  warnings: string[]
}

export function planHarvest(input: HarvestInput): HarvestPlan {
  const { parentLot, slurryVolume_mL, harvestDate, batchId, now = new Date() } = input
  const viability = currentViability(parentLot, now)
  const viabilityFrac = viability / 100
  const estimatedCells_B = Math.max(0, slurryVolume_mL) * SLURRY_CELLS_PER_ML_B * viabilityFrac
  const nextGen = parentLot.generation + 1

  const warnings: string[] = []
  if (nextGen >= GENERATION_WARN_AT)
    warnings.push(`Generation ${nextGen} — consider a fresh pitch (strain drift).`)
  if (viability < VIABILITY_FLOOR_PCT)
    warnings.push(`Parent viability is below ${VIABILITY_FLOOR_PCT}% — the harvest may be weak.`)

  const canSave = estimatedCells_B > 0
  if (!canSave)
    warnings.push(
      'Estimated cell count is 0 (dead parent or zero volume) — cannot save this harvest.',
    )

  const draft: YeastLotDraft = {
    name: parentLot.name,
    strain: parentLot.strain,
    labId: parentLot.labId,
    form: 'slurry',
    productionDate: harvestDate,
    initialCells_B: Math.max(estimatedCells_B, MIN_LOT_CELLS_B), // floored — never violates z.positive()
    generation: nextGen,
    parentLotId: parentLot.id,
    ...(batchId && { harvestedFromBatchId: batchId }),
    quantity: Math.max(0, slurryVolume_mL),
    unit: 'mL',
    source: batchId ? `harvest from batch` : 'harvest',
    notes_md: '',
    schemaVersion: 1,
  }
  return { draft, estimatedCells_B, canSave, warnings }
}
