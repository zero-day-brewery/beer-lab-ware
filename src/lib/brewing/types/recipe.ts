import { z } from 'zod'

import {
  FermentableUseSchema,
  HopUseSchema,
  MashStepSchema,
  MiscUseSchema,
  YeastUseSchema,
} from './recipe-parts'

export const RecipeTypeSchema = z.enum(['all-grain', 'extract', 'partial-mash', 'cider', 'mead'])

export const TargetsSchema = z.object({
  OG: z.number().optional(),
  FG: z.number().optional(),
  ABV: z.number().optional(),
  IBU: z.number().optional(),
  SRM: z.number().optional(),
})

export const RecipeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1, 'Name is required'),
    type: RecipeTypeSchema,
    batchSize_L: z.number().positive(),
    boilTime_min: z.number().nonnegative(),
    equipmentProfileId: z.string().uuid(),
    styleId: z.string().optional(),

    // Free-form organizational tags (folders-as-tags). Additive & OPTIONAL —
    // plain `.optional()` (NOT `.default([])`) so legacy recipes with no `tags`
    // key parse unchanged and no migration/schemaVersion bump is needed.
    tags: z.array(z.string()).optional(),

    // Lab-grade strike-water inputs (optional; sensible defaults applied in calc).
    grainTemp_C: z.number().optional(),
    mashThickness_LperKg: z.number().positive().optional(),

    fermentables: z.array(FermentableUseSchema),
    hops: z.array(HopUseSchema),
    yeasts: z.array(YeastUseSchema),
    miscs: z.array(MiscUseSchema),
    mashSteps: z.array(MashStepSchema),

    targets: TargetsSchema.optional(),
    notes_md: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    schemaVersion: z.literal(1),
  })
  .refine((r) => new Date(r.updatedAt).getTime() >= new Date(r.createdAt).getTime(), {
    message: 'updatedAt must be >= createdAt',
  })

export type Recipe = z.infer<typeof RecipeSchema>
export type RecipeType = z.infer<typeof RecipeTypeSchema>
export type Targets = z.infer<typeof TargetsSchema>
