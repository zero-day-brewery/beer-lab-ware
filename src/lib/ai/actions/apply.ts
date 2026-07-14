/**
 * Companion v2 Stage A — `applyAction`: the ONE and ONLY write path.
 *
 * SAFETY INVARIANT: the agent never writes. A propose tool (see
 * `../tools/write-tools.ts`) produces an {@link ActionDescriptor}; the Stage B
 * UI shows it to the human; and ONLY after approval does the app call
 * `applyAction`. This function:
 *   1. RE-VALIDATES `action.payload` with its Zod schema (the stored proposal is
 *      never trusted blindly) — a bad payload returns `{ ok:false }` and writes
 *      NOTHING (parse throws before any repo is touched).
 *   2. Commits via the EXISTING ATOMIC repo helpers only — no new non-atomic
 *      write path is introduced:
 *        scale_recipe / create_recipe → recipeRepo.save        (single atomic put)
 *        log_reading                  → readingsRepo.create     (single atomic put)
 *        adjust_inventory             → applyStockChange        (atomic ledger + amount tx)
 *
 * `writeDeps` is injectable so tests drive it with fakes / a throwaway Dexie db.
 */

import { type ActionDescriptor, AdjustInventoryPayloadSchema } from '@/lib/ai/actions/types'
import { type Reading, ReadingSchema } from '@/lib/brewing/types/reading'
import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'
import { readingsRepo } from '@/lib/db/repos/readings'
import { recipeRepo } from '@/lib/db/repos/recipe'
import type { ApplyStockChangeInput } from '@/lib/db/repos/stock-transactions'
import { stockTransactionsRepo } from '@/lib/db/repos/stock-transactions'

/** The write-capable subset of the repos `applyAction` needs. Injectable for tests. */
export interface ActionWriteDeps {
  recipes: { save(r: Recipe): Promise<Recipe> }
  readings: { create(r: Reading): Promise<Reading> }
  stock: { applyStockChange(input: ApplyStockChangeInput): Promise<number> }
}

/** Production deps: the Dexie-backed repo singletons (all atomic write helpers). */
export const defaultActionWriteDeps: ActionWriteDeps = {
  recipes: recipeRepo,
  readings: readingsRepo,
  stock: stockTransactionsRepo,
}

/** What a committed action produced (discriminated by `kind`). */
export type ApplyOutput =
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'reading'; reading: Reading }
  | { kind: 'inventory'; inventoryItemId: string; newAmount: number }

export type ApplyResult = { ok: true; result: ApplyOutput } | { ok: false; error: string }

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Commit an approved action atomically. Re-validates the payload FIRST (so a bad
 * payload can never reach a repo), then dispatches to the matching atomic helper.
 * Returns `{ ok:true, result }` on success, `{ ok:false, error }` on any Zod or
 * repo failure — never a partial write.
 */
export async function applyAction(
  action: ActionDescriptor,
  deps: ActionWriteDeps = defaultActionWriteDeps,
): Promise<ApplyResult> {
  try {
    switch (action.type) {
      case 'scale_recipe':
      case 'create_recipe': {
        const recipe = RecipeSchema.parse(action.payload)
        const saved = await deps.recipes.save(recipe)
        return { ok: true, result: { kind: 'recipe', recipe: saved } }
      }
      case 'log_reading': {
        const reading = ReadingSchema.parse(action.payload)
        const saved = await deps.readings.create(reading)
        return { ok: true, result: { kind: 'reading', reading: saved } }
      }
      case 'adjust_inventory': {
        const p = AdjustInventoryPayloadSchema.parse(action.payload)
        const newAmount = await deps.stock.applyStockChange({
          inventoryItemId: p.inventoryItemId,
          delta: p.delta,
          reason: p.reason,
          ...(p.note != null ? { note: p.note } : {}),
        })
        return {
          ok: true,
          result: { kind: 'inventory', inventoryItemId: p.inventoryItemId, newAmount },
        }
      }
      default: {
        // Exhaustiveness guard — a new action type must add a branch above.
        const _never: never = action
        return { ok: false, error: `applyAction: unknown action type ${JSON.stringify(_never)}` }
      }
    }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}
