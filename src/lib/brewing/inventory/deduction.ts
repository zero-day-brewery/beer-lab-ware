import { convertAmount } from '@/lib/brewing/convert/units'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem, InventoryKind } from '@/lib/brewing/types/inventory'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { RecipeUseRef } from '@/lib/brewing/types/stock-transaction'

/**
 * Phase 2b — pure deduction-plan builder.
 *
 * Turns a batch's `recipeSnapshot` into a reviewable list of "deduct THIS much
 * of THAT inventory item" lines. No DOM, no Dexie — the review component renders
 * the plan and the repo writes the consume-transactions on confirm.
 */

/** The recipe section a line came from (mirrors `RecipeUseRef.line`). */
export type DeductionLineKind = 'fermentable' | 'hop' | 'yeast' | 'misc'

/**
 * Per-line resolution status:
 *  - `ok`        matched, units convert, enough stock on hand.
 *  - `short`     matched + convertible but the draw exceeds on-hand (deducting
 *                clamps the item at 0; `resultingBalance` shows the shortfall).
 *  - `mismatch`  matched but the recipe unit can't convert to the item's unit
 *                (cross-dimension, or tsp/tbsp) — must be resolved manually.
 *  - `unmatched` no inventory item matched — pick one from `candidates`.
 */
export type DeductionStatus = 'ok' | 'short' | 'mismatch' | 'unmatched'

export interface DeductionLine {
  /** Recipe-use ingredient id (stable key + write-back target). */
  ingredientId: string
  /** Which recipe section this use came from. */
  line: DeductionLineKind
  /** Display name from the recipe-use snapshot. */
  name: string
  /** Recipe-side quantity, expressed in `recipeUnit`. */
  recipeQty: number
  /** Unit of `recipeQty` (kg for grain, g for hops, each for yeast, misc's own). */
  recipeUnit: string
  /** Inventory kind this line matches against (after catalog→inventory mapping). */
  inventoryKind: InventoryKind
  /** Matched inventory item id, or null when unmatched. */
  matchedItemId: string | null
  /** The matched inventory item (full row), or null. */
  matchedItem: InventoryItem | null
  /** Amount to deduct, in the matched item's unit; null when unmatched/mismatch. */
  draw: number | null
  /** Unit of `draw` (== matched item's `amountUnit`); null when unmatched. */
  drawUnit: string | null
  /** `matchedItem.amount − draw` (may be negative for `short`); null otherwise. */
  resultingBalance: number | null
  status: DeductionStatus
  /** Kind-filtered inventory items offered in the per-line select. */
  candidates: InventoryItem[]
  /** Provenance ref persisted on the consume-transaction. */
  recipeUseRef: RecipeUseRef
}

export interface BuildDeductionPlanInput {
  batch: Batch
  items: InventoryItem[]
  /** Reserved for future best-by/freshness weighting; unused today. */
  now?: Date
}

/**
 * Map a catalog/recipe ingredient kind to the inventory kind it stocks under.
 * The only non-identity mapping is catalog `water` → inventory `water-treatment`
 * (salts/agents live under the pantry's water-treatment bucket).
 */
export function catalogKindToInventoryKind(
  kind: 'fermentable' | 'hop' | 'yeast' | 'misc' | 'water',
): InventoryKind {
  return kind === 'water' ? 'water-treatment' : kind
}

/**
 * Recompute a line's draw/balance/status against a (possibly newly chosen)
 * inventory item. Pure — used both by {@link buildDeductionPlan} and by the
 * review component when the user changes a per-line select. Passing `null`
 * clears the match (→ `unmatched`).
 */
export function withMatch(line: DeductionLine, item: InventoryItem | null): DeductionLine {
  if (!item) {
    return {
      ...line,
      matchedItemId: null,
      matchedItem: null,
      draw: null,
      drawUnit: null,
      resultingBalance: null,
      status: 'unmatched',
    }
  }
  const draw = convertAmount(line.recipeQty, line.recipeUnit, item.amountUnit)
  if (draw === null) {
    return {
      ...line,
      matchedItemId: item.id,
      matchedItem: item,
      draw: null,
      drawUnit: item.amountUnit,
      resultingBalance: null,
      status: 'mismatch',
    }
  }
  const resultingBalance = item.amount - draw
  return {
    ...line,
    matchedItemId: item.id,
    matchedItem: item,
    draw,
    drawUnit: item.amountUnit,
    resultingBalance,
    status: draw > item.amount ? 'short' : 'ok',
  }
}

/** Resolve a single recipe use into a fully-computed {@link DeductionLine}. */
function resolveLine(params: {
  ingredientId: string
  line: DeductionLineKind
  name: string
  recipeQty: number
  recipeUnit: string
  inventoryKind: InventoryKind
  rememberedId: string | undefined
  items: InventoryItem[]
}): DeductionLine {
  const { ingredientId, line, name, recipeQty, recipeUnit, inventoryKind, rememberedId, items } =
    params
  const candidates = items.filter((i) => i.ingredientKind === inventoryKind)

  // Match order: remembered link (if the item still exists) → exact
  // case-insensitive name + kind → unmatched.
  let matched: InventoryItem | null = null
  if (rememberedId) {
    matched = items.find((i) => i.id === rememberedId) ?? null
  }
  if (!matched) {
    const target = name.trim().toLowerCase()
    matched =
      items.find(
        (i) => i.ingredientKind === inventoryKind && i.name.trim().toLowerCase() === target,
      ) ?? null
  }

  const base: DeductionLine = {
    ingredientId,
    line,
    name,
    recipeQty,
    recipeUnit,
    inventoryKind,
    matchedItemId: null,
    matchedItem: null,
    draw: null,
    drawUnit: null,
    resultingBalance: null,
    status: 'unmatched',
    candidates,
    recipeUseRef: { ingredientId, line },
  }
  return withMatch(base, matched)
}

/**
 * Build the ordered deduction plan for a batch. Sources amounts from
 * `batch.recipeSnapshot`: fermentables (kg), hops (g), yeasts (count/each),
 * miscs (own unit; `water-agent` miscs match the water-treatment bucket).
 * Returns `[]` when the batch has no recipe snapshot.
 */
export function buildDeductionPlan({ batch, items }: BuildDeductionPlanInput): DeductionLine[] {
  const recipe = batch.recipeSnapshot
  if (!recipe) return []
  const lines: DeductionLine[] = []

  for (const f of recipe.fermentables) {
    lines.push(
      resolveLine({
        ingredientId: f.ingredientId,
        line: 'fermentable',
        name: f.snapshot.name,
        recipeQty: f.amount_kg,
        recipeUnit: 'kg',
        inventoryKind: catalogKindToInventoryKind('fermentable'),
        rememberedId: f.inventoryItemId,
        items,
      }),
    )
  }

  for (const h of recipe.hops) {
    lines.push(
      resolveLine({
        ingredientId: h.ingredientId,
        line: 'hop',
        name: h.snapshot.name,
        recipeQty: h.amount_g,
        recipeUnit: 'g',
        inventoryKind: catalogKindToInventoryKind('hop'),
        rememberedId: h.inventoryItemId,
        items,
      }),
    )
  }

  for (const y of recipe.yeasts) {
    lines.push(
      resolveLine({
        ingredientId: y.ingredientId,
        line: 'yeast',
        name: y.snapshot.name,
        recipeQty: y.amount,
        recipeUnit: 'each',
        inventoryKind: catalogKindToInventoryKind('yeast'),
        rememberedId: y.inventoryItemId,
        items,
      }),
    )
  }

  for (const m of recipe.miscs) {
    // A water-agent misc (gypsum, CaCl₂…) stocks under water-treatment; every
    // other misc under the generic misc bucket.
    const catalogKind = m.snapshot.type === 'water-agent' ? 'water' : 'misc'
    lines.push(
      resolveLine({
        ingredientId: m.ingredientId,
        line: 'misc',
        name: m.snapshot.name,
        recipeQty: m.amount,
        recipeUnit: m.amountUnit,
        inventoryKind: catalogKindToInventoryKind(catalogKind),
        rememberedId: m.inventoryItemId,
        items,
      }),
    )
  }

  return lines
}

/**
 * Best-effort "remembered link" write-back: stamp each deducted line's matched
 * inventory item id onto the LIVE recipe's matching use (by `ingredientId` +
 * section), so the next brew auto-resolves. Pure — returns a NEW recipe plus a
 * `changed` flag so the caller only persists when something actually moved.
 * Only lines that produced a real match contribute; `unmatched`/`mismatch`
 * lines (matchedItemId null) leave their use untouched.
 */
export function applyRememberedLinks(
  recipe: Recipe,
  lines: readonly DeductionLine[],
): { recipe: Recipe; changed: boolean } {
  let changed = false
  const linkFor = (kind: DeductionLineKind, id: string): string | undefined =>
    lines.find((l) => l.line === kind && l.ingredientId === id && l.matchedItemId)?.matchedItemId ??
    undefined
  const setLink = <T extends { ingredientId: string; inventoryItemId?: string }>(
    use: T,
    kind: DeductionLineKind,
  ): T => {
    const link = linkFor(kind, use.ingredientId)
    if (link && use.inventoryItemId !== link) {
      changed = true
      return { ...use, inventoryItemId: link }
    }
    return use
  }
  const next: Recipe = {
    ...recipe,
    fermentables: recipe.fermentables.map((f) => setLink(f, 'fermentable')),
    hops: recipe.hops.map((h) => setLink(h, 'hop')),
    yeasts: recipe.yeasts.map((y) => setLink(y, 'yeast')),
    miscs: recipe.miscs.map((m) => setLink(m, 'misc')),
  }
  return { recipe: next, changed }
}
