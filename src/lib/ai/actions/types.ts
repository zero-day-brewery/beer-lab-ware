/**
 * Companion v2 Stage A — the CONFIRM-GATED write-action layer (types).
 *
 * SAFETY INVARIANT: the AGENT NEVER WRITES. A "propose" tool (see
 * `../tools/write-tools.ts`) only validates + builds a preview + a payload and
 * hands back an {@link ActionDescriptor}. The actual mutation happens ONLY later
 * when the human approves in the Stage B UI and the app calls `applyAction`
 * (see `./apply.ts`). Nothing in this file — or in the propose tools — touches a
 * repo write path.
 *
 * An {@link ActionDescriptor} is a discriminated union over `type`. Each variant
 * carries:
 *   - `title`   — a short label for the approval card.
 *   - `preview` — a truthful, human-readable description (string or small struct)
 *                 of EXACTLY what will change, computed at propose time.
 *   - `payload` — the Zod-validated data `applyAction` will commit. The payload
 *                 is RE-VALIDATED at apply time (the stored proposal is never
 *                 trusted blindly).
 */

import { z } from 'zod'
import { type Reading, ReadingSchema } from '@/lib/brewing/types/reading'
import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'
import { StockReasonSchema } from '@/lib/brewing/types/stock-transaction'

// ── per-type payload schemas (the ONLY thing `applyAction` commits) ─────────

/** Scale writes a brand-new recipe row (fresh id, scaled composition). */
export const ScaleRecipePayloadSchema = RecipeSchema
/** Create writes a brand-new recipe row from a full draft. */
export const CreateRecipePayloadSchema = RecipeSchema
/** Log-reading writes one fermentation reading row. */
export const LogReadingPayloadSchema = ReadingSchema
/**
 * Adjust-inventory writes ONE atomic ledger movement via `applyStockChange`
 * (item id + a SIGNED effective delta + a ledger reason). The running `amount`
 * is derived by the repo — never written directly here.
 */
export const AdjustInventoryPayloadSchema = z.object({
  inventoryItemId: z.string().uuid(),
  /** SIGNED delta in the item's own unit; negative = deduct. Clamped at 0 by the repo. */
  delta: z.number(),
  reason: StockReasonSchema,
  note: z.string().optional(),
})
export type AdjustInventoryPayload = z.infer<typeof AdjustInventoryPayloadSchema>

/** Apply-time payload schema lookup, keyed by action type. */
export const PAYLOAD_SCHEMAS = {
  scale_recipe: ScaleRecipePayloadSchema,
  create_recipe: CreateRecipePayloadSchema,
  log_reading: LogReadingPayloadSchema,
  adjust_inventory: AdjustInventoryPayloadSchema,
} as const

// ── preview shapes ──────────────────────────────────────────────────────────

/** Before → after struct for a recipe scale (batch size + computed OG). */
export interface ScaleRecipePreview {
  recipeName: string
  before: { batchSize_L: number; OG: number }
  after: { batchSize_L: number; OG: number }
}

// ── the discriminated action descriptors ────────────────────────────────────

export type ActionType = 'scale_recipe' | 'create_recipe' | 'log_reading' | 'adjust_inventory'

export interface ScaleRecipeAction {
  type: 'scale_recipe'
  title: string
  preview: ScaleRecipePreview
  payload: Recipe
}
export interface CreateRecipeAction {
  type: 'create_recipe'
  title: string
  preview: string
  payload: Recipe
}
export interface LogReadingAction {
  type: 'log_reading'
  title: string
  preview: string
  payload: Reading
}
export interface AdjustInventoryAction {
  type: 'adjust_inventory'
  title: string
  preview: string
  payload: AdjustInventoryPayload
}

export type ActionDescriptor =
  | ScaleRecipeAction
  | CreateRecipeAction
  | LogReadingAction
  | AdjustInventoryAction

/**
 * What a propose tool returns: a tagged proposal wrapping the descriptor. The
 * `kind: 'proposal'` tag lets the drawer/agent distinguish a proposed action
 * (needs human approval) from an ordinary read-tool result.
 */
export interface Proposal {
  kind: 'proposal'
  action: ActionDescriptor
}
