import { z } from 'zod'

export const IBUFormulaSchema = z.enum(['tinseth', 'rager', 'garetz', 'daniels'])
export const SRMFormulaSchema = z.enum(['morey', 'daniels', 'mosher'])
export const ABVFormulaSchema = z.enum(['simple', 'advanced'])

export const EquipmentProfileSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    isDefault: z.boolean(),

    // volumes (L)
    mashTunVolume_L: z.number().positive(),
    mashTunDeadSpace_L: z.number().nonnegative(),
    kettleVolume_L: z.number().positive(),
    kettleDeadSpace_L: z.number().nonnegative(),
    fermenterVolume_L: z.number().positive(),
    fermenterDeadSpace_L: z.number().nonnegative(),

    // process
    evaporationRate_LperHr: z.number().nonnegative(),
    coolingShrinkage_pct: z.number().min(0).max(100),
    topUpKettle_L: z.number().nonnegative(),
    topUpWater_L: z.number().nonnegative(),
    grainAbsorption_LperKg: z.number().nonnegative(),

    // efficiency (%)
    mashEfficiency_pct: z.number().min(0).max(100),
    brewhouseEfficiency_pct: z.number().min(0).max(100),

    // formula choices
    ibuFormula: IBUFormulaSchema,
    srmFormula: SRMFormulaSchema,
    abvFormula: ABVFormulaSchema,
    hopUtilizationMultiplier: z.number().positive(),

    // metadata
    calibrationDate: z.string().datetime().optional(),
    calibrationNotes_md: z.string(),
    schemaVersion: z.literal(1),
  })
  .refine((p) => p.fermenterVolume_L >= p.fermenterDeadSpace_L, {
    message: 'fermenterVolume_L must be >= fermenterDeadSpace_L',
  })
  .refine((p) => p.mashTunVolume_L >= p.mashTunDeadSpace_L, {
    message: 'mashTunVolume_L must be >= mashTunDeadSpace_L',
  })
  .refine((p) => p.kettleVolume_L >= p.kettleDeadSpace_L, {
    message: 'kettleVolume_L must be >= kettleDeadSpace_L',
  })

export type EquipmentProfile = z.infer<typeof EquipmentProfileSchema>
export type IBUFormula = z.infer<typeof IBUFormulaSchema>
export type SRMFormula = z.infer<typeof SRMFormulaSchema>
export type ABVFormula = z.infer<typeof ABVFormulaSchema>
