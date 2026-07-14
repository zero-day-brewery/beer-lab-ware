/** Zod schema for the persisted BrewSession body. Parsed on every Dexie read/write. */
import { z } from 'zod'

export const StepStatusSchema = z.enum(['pending', 'active', 'done', 'skipped', 'not-applicable'])

export const StepLogSchema = z.object({
  field: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  at: z.string(),
})

export const StepStateSchema = z.object({
  id: z.string(),
  status: StepStatusSchema,
  logs: z.array(StepLogSchema),
  completedAt: z.string().optional(),
})

export const TimerStateSchema = z.object({
  id: z.string(),
  stepId: z.string(),
  label: z.string(),
  fireAt: z.string(),
  status: z.enum(['armed', 'fired', 'cancelled']),
  firedAt: z.string().optional(),
})

export const SessionChoicesSchema = z.object({
  carbPath: z.enum(['co2', 'nitro']).optional(),
  noSparge: z.boolean().optional(),
  usesStarter: z.boolean().optional(),
  pressureFromPitch: z.boolean().optional(),
})

export const SessionWaterPlanSchema = z.object({
  sourceProfileName: z.string().optional(),
  additionsSummary: z.string().optional(),
  skipped: z.boolean().optional(),
  estMashPh: z.number().optional(),
})

export const SessionLifecycleSchema = z.enum([
  'idle',
  'running',
  'paused',
  'done',
  'archived',
  'aborted',
])

export const StageIdSchema = z.enum([
  'prep',
  'hotside',
  'fermentation',
  'packaging',
  'conditioning',
])

export const BrewSessionSchema = z.object({
  id: z.string(),
  recipeId: z.string().optional(),
  recipeName: z.string().optional(),
  // Chosen fermenter vessel (brew-start gate). Optional so legacy sessions parse.
  fermenterId: z.string().optional(),
  yeastLotId: z.string().uuid().optional(),
  manualVersion: z.number(),
  lifecycle: SessionLifecycleSchema,
  stageId: StageIdSchema,
  cursor: z.string(),
  resolvedSteps: z.array(z.string()),
  steps: z.record(z.string(), StepStateSchema),
  choices: SessionChoicesSchema,
  water: SessionWaterPlanSchema.optional(),
  timers: z.array(TimerStateSchema),
  startedAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.literal(1),
})

export type BrewSessionParsed = z.infer<typeof BrewSessionSchema>
