import { z } from 'zod'

const UUID = z.string().uuid()

// MashStep
export const MashStepSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['infusion', 'temperature', 'decoction']),
  temperature_C: z.number(),
  time_min: z.number().nonnegative(),
  rampTime_min: z.number().nonnegative().optional(),
  waterAmount_L: z.number().nonnegative().optional(),
})
export type MashStep = z.infer<typeof MashStepSchema>

// Snapshot shapes — minimal copies of ingredient catalog fields needed for calc + display
const FermentableSnapshot = z.object({
  name: z.string(),
  type: z.enum(['base', 'specialty', 'adjunct', 'extract', 'sugar']),
  ppg: z.number().positive(),
  color_L: z.number().nonnegative(),
})

const HopSnapshot = z.object({
  name: z.string(),
  alphaAcid_pct: z.number().min(0).max(30),
  form: z.enum(['pellet', 'leaf', 'plug', 'extract', 'cryo']),
})

const YeastSnapshot = z.object({
  name: z.string(),
  attenuation_min_pct: z.number().min(0).max(100),
  attenuation_max_pct: z.number().min(0).max(100),
  form: z.enum(['liquid', 'dry', 'slant', 'culture']),
})

const MiscSnapshot = z.object({
  name: z.string(),
  type: z.enum(['water-agent', 'fining', 'spice', 'flavor', 'other']),
})

// Uses
export const FermentableUseSchema = z.object({
  ingredientId: UUID,
  snapshot: FermentableSnapshot,
  amount_kg: z.number().nonnegative(),
  usage: z.enum(['mash', 'sparge', 'boil', 'fermenter', 'bottling']),
  afterBoil: z.boolean(),
  // Phase 2b "remembered link": the inventory item this use last deducted from,
  // so the next brew auto-resolves the match. Optional + additive — recipes are
  // JSON in db.recipes, so existing recipes parse unchanged (no Dexie bump).
  inventoryItemId: UUID.optional(),
})
export type FermentableUse = z.infer<typeof FermentableUseSchema>

export const HopUseSchema = z.object({
  ingredientId: UUID,
  snapshot: HopSnapshot,
  amount_g: z.number().nonnegative(),
  time_min: z.number().nonnegative(),
  use: z.enum(['mash', 'first-wort', 'boil', 'aroma', 'whirlpool', 'dry-hop']),
  // Phase 2b remembered link (see FermentableUseSchema).
  inventoryItemId: UUID.optional(),
})
export type HopUse = z.infer<typeof HopUseSchema>

export const YeastUseSchema = z.object({
  ingredientId: UUID,
  snapshot: YeastSnapshot,
  amount: z.number().nonnegative(),
  pitchTemp_C: z.number().optional(),
  attenuationOverride_pct: z.number().min(0).max(100).optional(),
  // Phase 2b remembered link (see FermentableUseSchema).
  inventoryItemId: UUID.optional(),
})
export type YeastUse = z.infer<typeof YeastUseSchema>

export const MiscUseSchema = z.object({
  ingredientId: UUID,
  snapshot: MiscSnapshot,
  amount: z.number().nonnegative(),
  amountUnit: z.enum(['g', 'ml', 'tsp', 'tbsp', 'each']),
  use: z.enum(['mash', 'boil', 'primary', 'secondary', 'bottling']),
  time_min: z.number().nonnegative(),
  // Phase 2b remembered link (see FermentableUseSchema).
  inventoryItemId: UUID.optional(),
})
export type MiscUse = z.infer<typeof MiscUseSchema>
