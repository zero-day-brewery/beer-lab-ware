/**
 * Yeast pitch plan — the thin combiner the brew-start picker + companion use.
 * Ties the pitch-rate engine to the FIFO-viable lot selector: compute how many
 * cells the batch needs (`calcPitchRate`), then pick the lot (`selectYeastLot`).
 * Pure — no DOM/Dexie.
 */

import { selectYeastLot, type YeastSelection } from '@/lib/brewing/inventory/yeast-selection'
import {
  calcPitchRate,
  type PitchRateResult,
  type PitchStyle,
} from '@/lib/brewing/pitch/pitch-rate'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

export interface YeastPitchPlanInput {
  og: number
  batchSize_L: number
  style: PitchStyle
  strain: string
  lots: YeastLot[]
  now?: Date
  viabilityFloorPct?: number
}

export interface YeastPitchPlan {
  pitch: PitchRateResult
  selection: YeastSelection
}

export function planYeastPitch(input: YeastPitchPlanInput): YeastPitchPlan {
  const pitch = calcPitchRate({
    og: input.og,
    batchSize_L: input.batchSize_L,
    style: input.style,
  })
  const selection = selectYeastLot({
    strain: input.strain,
    requiredCells_B: pitch.cells_B,
    lots: input.lots,
    now: input.now,
    viabilityFloorPct: input.viabilityFloorPct,
  })
  return { pitch, selection }
}
