import { toDisplay, unitLabel } from '@/lib/brewing/convert/display-units'
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem, InventoryKind, InventoryUnit } from '@/lib/brewing/types/inventory'
import type { Units } from '@/lib/brewing/types/settings'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'

/**
 * Per-batch COGS engine — joins the two halves the data model already stores
 * but nothing connects: exact per-batch consumption (batchId-linked ledger
 * txns) × `InventoryItem.pricePerUnit_USD`. Pure — no Dexie, no React; the
 * batch sheet section and the batch-record workbook both render its output.
 *
 * Money is ALWAYS explicit USD (the price field is `pricePerUnit_USD`); there
 * is no locale/currency guessing anywhere, hence `currency: 'USD'` on the
 * report. Items without a price are listed but NEVER estimated — their cost is
 * `null` and they are excluded from `knownCost`, surfaced via `unknownLines`.
 */

export interface BatchCostLine {
  itemName: string
  kind: InventoryKind
  /** Net quantity consumed by the batch, in `unit`. Negative when returns exceed deductions. */
  qty: number
  unit: InventoryUnit
  /** USD per `unit`, or null when the item has no price (or was deleted). */
  unitPrice: number | null
  /** `qty × unitPrice`, or null when unpriced. Negative lines reduce the total. */
  cost: number | null
}

export interface BatchCostReport {
  /** All net movements, kind-ordered then by name — priced and unpriced alike. */
  lines: BatchCostLine[]
  /** Σ of every priced line's cost. Unpriced lines contribute nothing. */
  knownCost: number
  /** The subset of `lines` with no price — render as "n items unpriced". */
  unknownLines: BatchCostLine[]
  /** Actual into-fermenter volume when measured, else recipe batch size, else null. */
  volume_L: number | null
  /** `knownCost / volume_L`; null when no volume is known or nothing is priced. */
  costPerLiter: number | null
  currency: 'USD'
}

export interface ComputeBatchCostInput {
  /** Only `results` (into-fermenter volume) + `recipeSnapshot` (size fallback, deleted-item names) are read. */
  batch: Pick<Batch, 'results' | 'recipeSnapshot'>
  /** The batch's ledger txns (`stockTransactionsRepo.listByBatch`). */
  txns: readonly StockTransaction[]
  /** The inventory items those txns reference — missing ids are treated as deleted. */
  items: readonly InventoryItem[]
}

/** Pantry display order — mirrors the inventory report's KIND_ORDER. */
const KIND_ORDER: InventoryKind[] = [
  'fermentable',
  'hop',
  'yeast',
  'misc',
  'water-treatment',
  'other',
]

/**
 * Best-effort name for a deleted item: the recipe snapshot still carries the
 * ingredient the txn's `recipeUseRef` points at; failing that, the txn note.
 */
function deletedItemName(
  txns: readonly StockTransaction[],
  recipe: Batch['recipeSnapshot'],
): string {
  for (const t of txns) {
    const ref = t.recipeUseRef
    if (ref && recipe) {
      const uses: ReadonlyArray<{ ingredientId: string; snapshot: { name: string } }> =
        ref.line === 'fermentable'
          ? recipe.fermentables
          : ref.line === 'hop'
            ? recipe.hops
            : ref.line === 'yeast'
              ? recipe.yeasts
              : recipe.miscs
      const use = uses.find((u) => u.ingredientId === ref.ingredientId)
      if (use) return use.snapshot.name
    }
  }
  const noted = txns.find((t) => t.note && t.note.trim() !== '')
  return noted?.note ?? 'deleted item'
}

export function computeBatchCost(input: ComputeBatchCostInput): BatchCostReport {
  const { batch, txns, items } = input
  const itemById = new Map(items.map((i) => [i.id, i]))

  // sync-reconcile entries are sync-merge accounting corrections, not
  // purchases or consumption — they never belong in a cost sheet.
  const costable = txns.filter((t) => t.reason !== 'sync-reconcile')

  // Net per (item, unit): deductions are negative deltas, so qty = -Σdelta.
  // Positive deltas (returns / adjustments) reduce the net and thus the cost.
  const groups = new Map<string, StockTransaction[]>()
  for (const t of costable) {
    const key = `${t.inventoryItemId}|${t.unit}`
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }

  const lines: BatchCostLine[] = []
  for (const groupTxns of groups.values()) {
    const first = groupTxns[0]
    if (!first) continue
    const qty = -groupTxns.reduce((sum, t) => sum + t.delta, 0)
    if (qty === 0) continue // fully returned — nothing consumed, nothing to cost
    const item = itemById.get(first.inventoryItemId)
    const unitPrice = item?.pricePerUnit_USD ?? null
    lines.push({
      itemName: item?.name ?? deletedItemName(groupTxns, batch.recipeSnapshot),
      kind: item?.ingredientKind ?? first.kind,
      qty,
      unit: first.unit,
      unitPrice,
      cost: unitPrice === null ? null : qty * unitPrice,
    })
  }

  lines.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.itemName.localeCompare(b.itemName, undefined, { sensitivity: 'base' }),
  )

  const priced = lines.filter((l) => l.cost !== null)
  const knownCost = priced.reduce((sum, l) => sum + (l.cost ?? 0), 0)
  const unknownLines = lines.filter((l) => l.cost === null)

  const measured = batch.results.intoFermenter_L
  const recipeSize = batch.recipeSnapshot?.batchSize_L
  const volume_L =
    measured !== undefined && measured > 0
      ? measured
      : recipeSize !== undefined && recipeSize > 0
        ? recipeSize
        : null

  const costPerLiter = volume_L !== null && priced.length > 0 ? knownCost / volume_L : null

  return { lines, knownCost, unknownLines, volume_L, costPerLiter, currency: 'USD' }
}

/**
 * The cost-per-volume figure in the user's DISPLAY units ($/L or $/gal) —
 * derived from the same canonical `knownCost / volume_L`, so metric mode is
 * the identity. Null exactly when `costPerLiter` is null.
 */
export function costPerDisplayVolume(
  report: BatchCostReport,
  units: Units,
): { value: number; volumeUnit: string } | null {
  if (report.costPerLiter === null || report.volume_L === null) return null
  return {
    value: report.knownCost / toDisplay(report.volume_L, 'volume', units),
    volumeUnit: unitLabel('volume', units),
  }
}
