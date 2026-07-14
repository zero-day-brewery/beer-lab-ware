import { z } from 'zod'
import type { ProcessStep, StepId } from '@/lib/brewing/process/types'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import { EquipmentProfileSchema } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { RecipeSchema } from '@/lib/brewing/types/recipe'
import type { CalculationResult } from '@/lib/brewing/types/results'
import { CalculationResultSchema } from '@/lib/brewing/types/results'

export interface LogEntry {
  key: string
  label: string
  stepId: StepId
  value: string | number | boolean
  unit?: string
  target?: number
  at: string
}

export interface BatchTimer {
  id: string
  label: string
  firedAt?: string
  durationMin: number
}

export type CarbMethod = 'co2-set-and-wait' | 'co2-burst' | 'nitro' | 'natural-spunding'

export interface BatchResults {
  measuredOG?: number
  measuredFG?: number
  measuredABV?: number
  preBoilGravity?: number
  preBoilVolume_L?: number
  intoFermenter_L?: number
  mashEfficiency_pct?: number
  brewhouseEfficiency_pct?: number
  apparentAttenuation_pct?: number
  carbMethod?: CarbMethod
  gasBlend?: '75/25' | '70/30'
  targetCo2_vol?: number
  measuredCo2_vol?: number
  spundingSetpoint_psi?: number
  dispense_psi?: number
}

export interface BJCPScores {
  aroma: number
  appearance: number
  flavor: number
  mouthfeel: number
  overall: number
  total: number
}

export interface Tasting {
  aroma_md?: string
  appearance_md?: string
  flavor_md?: string
  mouthfeel_md?: string
  overall_md?: string
  /** Simple 0–5 overall rating. Optional (additive) — legacy batches parse unchanged. */
  rating?: number
  bjcp?: BJCPScores
}

export interface Batch {
  id: string
  batchNo: number
  name: string
  status: 'in-progress' | 'complete' | 'archived'
  recipeId?: string
  equipmentProfileId?: string
  recipeSnapshot?: Recipe
  equipmentSnapshot?: EquipmentProfile
  computedTargets?: CalculationResult
  // Free-form board id: the seed vessels are still 'f1'..'f4', but user-added
  // fermenters carry a uuid, so this is a plain string (was a fixed enum).
  fermenterBoardId?: string
  /** The yeast lot pitched into this batch (carried from the session). */
  yeastLotId?: string
  /** True once brew-time yeast deduction has fired for this batch (idempotency marker). */
  yeastDeducted?: boolean
  waterSourceName?: string
  waterAdditionsSummary?: string
  waterSkipped?: boolean
  estMashPh?: number
  measuredMashPh?: number
  process: ProcessStep[]
  logs: LogEntry[]
  timers: BatchTimer[]
  results: BatchResults
  tasting?: Tasting
  outcomeNotes_md?: string
  startedAt: string
  brewedAt?: string
  completedAt?: string
  archivedAt?: string
  updatedAt: string
  schemaVersion: 1
}

const LogEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  stepId: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  unit: z.string().optional(),
  target: z.number().optional(),
  at: z.string(),
})

const BatchTimerSchema = z.object({
  id: z.string(),
  label: z.string(),
  firedAt: z.string().optional(),
  durationMin: z.number(),
})

const CarbMethodSchema = z.enum(['co2-set-and-wait', 'co2-burst', 'nitro', 'natural-spunding'])

const BatchResultsSchema = z.object({
  measuredOG: z.number().optional(),
  measuredFG: z.number().optional(),
  measuredABV: z.number().optional(),
  preBoilGravity: z.number().optional(),
  preBoilVolume_L: z.number().optional(),
  intoFermenter_L: z.number().optional(),
  mashEfficiency_pct: z.number().optional(),
  brewhouseEfficiency_pct: z.number().optional(),
  apparentAttenuation_pct: z.number().optional(),
  carbMethod: CarbMethodSchema.optional(),
  gasBlend: z.enum(['75/25', '70/30']).optional(),
  targetCo2_vol: z.number().optional(),
  measuredCo2_vol: z.number().optional(),
  spundingSetpoint_psi: z.number().optional(),
  dispense_psi: z.number().optional(),
})

const BJCPScoresSchema = z.object({
  aroma: z.number(),
  appearance: z.number(),
  flavor: z.number(),
  mouthfeel: z.number(),
  overall: z.number(),
  total: z.number(),
})

const TastingSchema = z.object({
  aroma_md: z.string().optional(),
  appearance_md: z.string().optional(),
  flavor_md: z.string().optional(),
  mouthfeel_md: z.string().optional(),
  overall_md: z.string().optional(),
  rating: z.number().int().min(0).max(5).optional(),
  bjcp: BJCPScoresSchema.optional(),
})

// ProcessStep contains union types (BoardEffect, BranchPredicate, etc.) tied to the
// live session store. z.custom<ProcessStep>() infers the correct type while accepting
// any value at runtime — structural validation happens at session start.

export const BatchSchema = z.object({
  id: z.string().uuid(),
  batchNo: z.number().int().nonnegative(),
  name: z.string(),
  status: z.enum(['in-progress', 'complete', 'archived']),
  recipeId: z.string().optional(),
  equipmentProfileId: z.string().optional(),
  recipeSnapshot: RecipeSchema.optional(),
  equipmentSnapshot: EquipmentProfileSchema.optional(),
  computedTargets: CalculationResultSchema.optional(),
  // Widened from z.enum(['f1'..'f4']); additive — old ids still parse, uuids too.
  fermenterBoardId: z.string().optional(),
  yeastLotId: z.string().uuid().optional(),
  yeastDeducted: z.boolean().optional(),
  waterSourceName: z.string().optional(),
  waterAdditionsSummary: z.string().optional(),
  waterSkipped: z.boolean().optional(),
  estMashPh: z.number().optional(),
  measuredMashPh: z.number().optional(),
  process: z.array(z.custom<ProcessStep>()),
  logs: z.array(LogEntrySchema),
  timers: z.array(BatchTimerSchema),
  results: BatchResultsSchema,
  tasting: TastingSchema.optional(),
  outcomeNotes_md: z.string().optional(),
  startedAt: z.string(),
  brewedAt: z.string().optional(),
  completedAt: z.string().optional(),
  archivedAt: z.string().optional(),
  updatedAt: z.string(),
  schemaVersion: z.literal(1),
})
