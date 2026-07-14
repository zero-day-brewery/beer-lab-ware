import { z } from 'zod'

const Range = z
  .tuple([z.number(), z.number()])
  .refine(([min, max]) => min <= max, { message: 'min must be <= max' })

export const VitalStatsSchema = z.object({
  OG: Range,
  FG: Range,
  IBU: Range,
  SRM: Range,
  ABV: Range,
})

export const BJCPStyleSchema = z.object({
  id: z.string().min(1),
  categoryNumber: z.string().min(1),
  categoryName: z.string().min(1),
  name: z.string().min(1),
  vitalStats: VitalStatsSchema,
  description_md: z.string(),
})

export type BJCPStyle = z.infer<typeof BJCPStyleSchema>
export type VitalStats = z.infer<typeof VitalStatsSchema>
