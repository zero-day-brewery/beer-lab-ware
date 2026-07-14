import { z } from 'zod'

const UUID = z.string().uuid()

export const FermentableSchema = z.object({
  id: UUID,
  kind: z.literal('fermentable'),
  name: z.string().min(1),
  type: z.enum(['base', 'specialty', 'adjunct', 'extract', 'sugar']),
  ppg: z.number().positive(),
  color_L: z.number().nonnegative(),
  origin: z.string(),
  supplier: z.string(),
  maxInBatch_pct: z.number().min(0).max(100),
  notes_md: z.string(),
})

export const HopOilsSchema = z.object({
  myrcene: z.number().optional(),
  humulene: z.number().optional(),
  caryophyllene: z.number().optional(),
  farnesene: z.number().optional(),
})

export const HopSchema = z.object({
  id: UUID,
  kind: z.literal('hop'),
  name: z.string().min(1),
  alphaAcid_pct: z.number().min(0).max(30),
  beta_pct: z.number().min(0).max(30),
  type: z.enum(['bittering', 'aroma', 'dual']),
  oils: HopOilsSchema.optional(),
  substitutes: z.array(z.string()),
  origin: z.string(),
  notes_md: z.string(),
})

export const YeastSchema = z
  .object({
    id: UUID,
    kind: z.literal('yeast'),
    name: z.string().min(1),
    lab: z.string(),
    productCode: z.string(),
    type: z.enum(['ale', 'lager', 'wheat', 'wild', 'champagne', 'kveik']),
    form: z.enum(['liquid', 'dry', 'slant', 'culture']),
    attenuation_min_pct: z.number().min(0).max(100),
    attenuation_max_pct: z.number().min(0).max(100),
    flocculation: z.enum(['low', 'medium', 'high', 'very-high']),
    temp_min_C: z.number(),
    temp_max_C: z.number(),
    esterProfile: z.string(),
    notes_md: z.string(),
  })
  .refine((y) => y.attenuation_min_pct <= y.attenuation_max_pct, {
    message: 'attenuation_min_pct must be <= attenuation_max_pct',
  })
  .refine((y) => y.temp_min_C <= y.temp_max_C, {
    message: 'temp_min_C must be <= temp_max_C',
  })

export const MiscSchema = z.object({
  id: UUID,
  kind: z.literal('misc'),
  name: z.string().min(1),
  type: z.enum(['water-agent', 'fining', 'spice', 'flavor', 'other']),
  defaultUse: z.enum(['mash', 'boil', 'primary', 'secondary', 'bottling']),
  notes_md: z.string(),
})

export const WaterSchema = z.object({
  id: UUID,
  kind: z.literal('water'),
  name: z.string().min(1),
  Ca_ppm: z.number().nonnegative(),
  Mg_ppm: z.number().nonnegative(),
  Na_ppm: z.number().nonnegative(),
  SO4_ppm: z.number().nonnegative(),
  Cl_ppm: z.number().nonnegative(),
  HCO3_ppm: z.number().nonnegative(),
})

// Discriminated union — Zod 4 allows refined schemas here, so Yeast is included directly.
export const IngredientSchema = z.discriminatedUnion('kind', [
  FermentableSchema,
  HopSchema,
  YeastSchema,
  MiscSchema,
  WaterSchema,
])

// General union alias — included for parity and explicit yeast-targeted parsing paths.
export const IngredientAnySchema = z.union([
  FermentableSchema,
  HopSchema,
  YeastSchema,
  MiscSchema,
  WaterSchema,
])

export type Fermentable = z.infer<typeof FermentableSchema>
export type Hop = z.infer<typeof HopSchema>
export type Yeast = z.infer<typeof YeastSchema>
export type Misc = z.infer<typeof MiscSchema>
export type Water = z.infer<typeof WaterSchema>
export type Ingredient = Fermentable | Hop | Yeast | Misc | Water
