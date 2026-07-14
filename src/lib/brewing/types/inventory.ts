import { z } from 'zod'

export const InventoryKindSchema = z.enum([
  'fermentable',
  'hop',
  'yeast',
  'misc',
  'water-treatment',
  'other',
])
export type InventoryKind = z.infer<typeof InventoryKindSchema>

export const InventoryUnitSchema = z.enum(['g', 'kg', 'oz', 'lb', 'ml', 'L', 'each', 'packets'])
export type InventoryUnit = z.infer<typeof InventoryUnitSchema>

export const InventoryStatusSchema = z.enum(['sealed', 'opened'])
export type InventoryStatus = z.infer<typeof InventoryStatusSchema>

export const InventoryItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  ingredientKind: InventoryKindSchema,
  amount: z.number().nonnegative(),
  amountUnit: InventoryUnitSchema,
  lowStockThreshold: z.number().nonnegative().optional(),
  vendor: z.string().optional(),
  purchaseDate: z.string().datetime().optional(),
  bestByDate: z.string().datetime().optional(),
  // When a sealed item was opened — drives "opened N days ago" aging.
  // Additive (2026-07-05, backlog #19): optional + not indexed, so legacy rows
  // parse unchanged and no Dexie version bump is needed. schemaVersion stays 1.
  openedDate: z.string().datetime().optional(),
  pricePerUnit_USD: z.number().nonnegative().optional(),
  // Target stock qty for the shopping list (par-level restock). Additive/optional.
  parLevel: z.number().nonnegative().optional(),
  storageLocation: z.string().optional(),
  status: InventoryStatusSchema,
  notes_md: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
})

export type InventoryItem = z.infer<typeof InventoryItemSchema>

/**
 * Is this item below its low-stock threshold? Returns false if no threshold set.
 */
export function isLowStock(item: InventoryItem): boolean {
  if (item.lowStockThreshold === undefined) return false
  return item.amount <= item.lowStockThreshold
}

/**
 * Is this item past its best-by date? Returns false if no best-by set or it's in the future.
 */
export function isPastBestBy(item: InventoryItem, now: Date = new Date()): boolean {
  if (!item.bestByDate) return false
  return new Date(item.bestByDate).getTime() < now.getTime()
}
