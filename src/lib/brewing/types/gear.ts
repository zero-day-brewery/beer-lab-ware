import { z } from 'zod'

export const GearCategorySchema = z.enum([
  'kettle',
  'mash-tun',
  'fermenter',
  'pump',
  'instrument',
  'kegging',
  'bottling',
  'cleaning',
  'storage',
  'other',
])
export type GearCategory = z.infer<typeof GearCategorySchema>

export const GearConditionSchema = z.enum(['new', 'good', 'worn', 'broken', 'retired'])
export type GearCondition = z.infer<typeof GearConditionSchema>

export const GearItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  category: GearCategorySchema,
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: z.string().datetime().optional(),
  pricePaid_USD: z.number().nonnegative().optional(),
  replacementCost_USD: z.number().nonnegative().optional(),
  vendor: z.string().optional(),
  location: z.string().optional(),
  condition: GearConditionSchema,
  notes_md: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
})

export type GearItem = z.infer<typeof GearItemSchema>
