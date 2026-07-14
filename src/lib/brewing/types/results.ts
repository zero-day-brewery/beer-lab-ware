import { z } from 'zod'

export const VolumesSchema = z.object({
  mashWater_L: z.number().nonnegative(),
  spargeWater_L: z.number().nonnegative(),
  preBoilVolume_L: z.number().nonnegative(),
  postBoilVolume_L: z.number().nonnegative(),
  intoFermenter_L: z.number().nonnegative(),
})

export const FormulasUsedSchema = z.object({
  ibu: z.enum(['tinseth', 'rager', 'garetz', 'daniels']),
  srm: z.enum(['morey', 'daniels', 'mosher']),
  abv: z.enum(['simple', 'advanced']),
})

export const CalculationResultSchema = z.object({
  volumes: VolumesSchema,
  OG: z.number().positive(),
  FG: z.number().positive(),
  ABV: z.number().nonnegative(),
  IBU: z.number().nonnegative(),
  SRM: z.number().nonnegative(),
  strikeTemp_C: z.number(),
  formulasUsed: FormulasUsedSchema,
  computedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
})

export type Volumes = z.infer<typeof VolumesSchema>
export type FormulasUsed = z.infer<typeof FormulasUsedSchema>
export type CalculationResult = z.infer<typeof CalculationResultSchema>
