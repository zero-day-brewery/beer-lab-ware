import { z } from 'zod'
import {
  type InventoryItem,
  InventoryKindSchema,
  InventoryUnitSchema,
} from '@/lib/brewing/types/inventory'

/**
 * Why a stock is moving. Append-only audit trail semantics:
 *  - `opening`       first balance recorded when the item starts being tracked
 *                    (v7 migration backfill, or a brand-new item's initial qty).
 *  - `restock`       bought more / added stock.
 *  - `manual-adjust` a correction from the edit form or the Adjust modal.
 *  - `spoilage`      stock written off (expired, spilled, dumped).
 *  - `brew-deduct`   consumed by a brew. RESERVED for Phase 2b (auto-deduct);
 *                    defined now so 2b needs no schema/version change.
 */
export const StockReasonSchema = z.enum([
  'opening',
  'restock',
  'manual-adjust',
  'spoilage',
  'brew-deduct',
])
export type StockReason = z.infer<typeof StockReasonSchema>

/**
 * Provenance back to the recipe line that consumed the stock. RESERVED for
 * Phase 2b (recipe↔inventory matching); unused in 2a but persisted if present.
 */
export const RecipeUseRefSchema = z.object({
  ingredientId: z.string(),
  line: z.enum(['fermentable', 'hop', 'yeast', 'misc']),
})
export type RecipeUseRef = z.infer<typeof RecipeUseRefSchema>

/**
 * A single, immutable movement of an inventory item's on-hand stock. The ledger
 * is append-only; `InventoryItem.amount` is a cached running balance kept equal
 * to the signed sum of every txn's `delta` for that item (invariant:
 * `amount === Σ deltas`). Zod at the persistence boundary (CLAUDE.md convention).
 */
export const StockTransactionSchema = z.object({
  id: z.string().uuid(),
  inventoryItemId: z.string().uuid(), // FK → db.inventoryItems
  kind: InventoryKindSchema, // denormalized item kind (for grouping/reporting)
  delta: z.number(), // SIGNED, expressed in `unit`; negative = deduct
  unit: InventoryUnitSchema, // == item.amountUnit for 2a (no unit conversion yet)
  reason: StockReasonSchema,
  batchId: z.string().uuid().optional(), // set by 2b brew-deduct
  recipeUseRef: RecipeUseRefSchema.optional(), // 2b provenance
  note: z.string().optional(),
  at: z.string().datetime(), // ISO timestamp
  schemaVersion: z.literal(1),
})

export type StockTransaction = z.infer<typeof StockTransactionSchema>

/**
 * Build an (unvalidated) stock txn from an item + a signed delta. Pure — the
 * caller Zod-parses before persisting (the repo's `append`/`applyStockChange`
 * do). `id`/`at` are injected so callers own the uuid source + timestamp.
 * The v7 migration deliberately does NOT use this (migrations stay self-contained
 * so future edits here can't rewrite historical backfill behavior).
 */
export function buildStockTransaction(params: {
  id: string
  item: Pick<InventoryItem, 'id' | 'ingredientKind' | 'amountUnit'>
  delta: number
  reason: StockReason
  at: string
  note?: string
  batchId?: string
  recipeUseRef?: RecipeUseRef
}): StockTransaction {
  return {
    id: params.id,
    inventoryItemId: params.item.id,
    kind: params.item.ingredientKind,
    delta: params.delta,
    unit: params.item.amountUnit,
    reason: params.reason,
    at: params.at,
    ...(params.note !== undefined ? { note: params.note } : {}),
    ...(params.batchId !== undefined ? { batchId: params.batchId } : {}),
    ...(params.recipeUseRef !== undefined ? { recipeUseRef: params.recipeUseRef } : {}),
    schemaVersion: 1,
  }
}

/**
 * Running on-hand balance after each txn, given chronological txns. Pure — used
 * by the history timeline. `balances[i]` is the balance immediately after
 * `txns[i]` (cumulative signed sum of deltas). For a consistent ledger the last
 * element equals the item's cached `amount`.
 */
export function runningBalances(txns: readonly Pick<StockTransaction, 'delta'>[]): number[] {
  let balance = 0
  return txns.map((t) => {
    balance += t.delta
    return balance
  })
}
