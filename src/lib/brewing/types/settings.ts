import { z } from 'zod'

export const UnitsSchema = z.enum(['metric', 'imperial'])
export type Units = z.infer<typeof UnitsSchema>

export const ThemeSchema = z.enum([
  'default',
  'matrix',
  'cyberpunk',
  'neon',
  'soundwave',
  'metal-cyberpunk',
])
export type Theme = z.infer<typeof ThemeSchema>

export const GravityUnitSchema = z.enum(['sg', 'plato'])
export type GravityUnit = z.infer<typeof GravityUnitSchema>

export const SettingsSchema = z.object({
  id: z.literal('global'),
  units: UnitsSchema,
  defaultEquipmentProfileId: z.string().uuid(),
  theme: ThemeSchema,
  // Optional + null-safe defaulting at every read (`?? 'sg'`): old settings rows
  // (pre-2026-06-23) parse unchanged with no DB migration.
  gravityUnit: GravityUnitSchema.optional(),
  schemaVersion: z.literal(1),
})

export type Settings = z.infer<typeof SettingsSchema>
