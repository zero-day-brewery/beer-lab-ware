/**
 * Pure mapper: Brewfather inventory JSON (fermentables/hops/yeasts/miscs) →
 * app `InventoryItem` + its `opening` ledger transaction. No I/O, no clock —
 * the caller injects `now`. Every imported item carries exactly one opening
 * txn with `delta === amount`, so the doctor's C1 invariant
 * (`amount === Σ deltas`) holds from the moment the import lands.
 *
 * Units are Brewfather's metric-native storage: fermentables in kg, hops in g,
 * yeast in packages ("pkg") unless the item says otherwise, miscs in their own
 * unit field. A unit with no app equivalent skips the item with a warning —
 * never a silent guess.
 */
import type { InventoryItem, InventoryUnit } from '@/lib/brewing/types/inventory'
import { InventoryItemSchema } from '@/lib/brewing/types/inventory'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import {
  buildStockTransaction,
  StockTransactionSchema,
} from '@/lib/brewing/types/stock-transaction'
import { brewfatherId } from './ids'
import { type BfInventoryItem, BfInventoryItemSchema, bfTimestampToIso } from './schemas'

export type BfInventoryKind = 'fermentable' | 'hop' | 'yeast' | 'misc'

export interface MappedInventoryItem {
  item: InventoryItem | null
  opening: StockTransaction | null
  warnings: string[]
}

interface UnitResolution {
  unit: InventoryUnit | null
  /** Multiplier applied to the amount when the unit converts (e.g. l → L is 1:1). */
  factor: number
}

function resolveUnit(kind: BfInventoryKind, rawUnit: string | undefined): UnitResolution {
  const lower = rawUnit?.toLowerCase()
  if (kind === 'fermentable') return { unit: 'kg', factor: 1 }
  if (kind === 'hop') return { unit: 'g', factor: 1 }
  if (kind === 'yeast') {
    if (lower === 'g') return { unit: 'g', factor: 1 }
    if (lower === 'ml') return { unit: 'ml', factor: 1 }
    if (lower === 'l') return { unit: 'L', factor: 1 }
    // Brewfather's default yeast unit is packages.
    if (lower === undefined || lower === 'pkg' || lower === 'pkgs' || lower === 'packet')
      return { unit: 'packets', factor: 1 }
    return { unit: null, factor: 1 }
  }
  // misc
  if (lower === undefined || lower === 'g') return { unit: 'g', factor: 1 }
  if (lower === 'kg') return { unit: 'kg', factor: 1 }
  if (lower === 'ml') return { unit: 'ml', factor: 1 }
  if (lower === 'l') return { unit: 'L', factor: 1 }
  if (lower === 'oz') return { unit: 'oz', factor: 1 }
  if (lower === 'lb') return { unit: 'lb', factor: 1 }
  if (lower === 'items' || lower === 'item' || lower === 'each') return { unit: 'each', factor: 1 }
  return { unit: null, factor: 1 }
}

function displayName(kind: BfInventoryKind, bf: BfInventoryItem, fallback: string): string {
  const base = bf.name?.trim() || fallback
  // Yeast: fold the lab product id into the name when it isn't already there —
  // both fields come straight from the file, nothing is invented.
  if (kind === 'yeast' && bf.productId?.trim()) {
    const pid = bf.productId.trim()
    if (!base.toLowerCase().includes(pid.toLowerCase())) return `${base} (${pid})`
  }
  return base
}

export function mapBrewfatherInventoryItem(
  raw: unknown,
  kind: BfInventoryKind,
  opts: { now: string },
): MappedInventoryItem {
  const warnings: string[] = []
  const parsed = BfInventoryItemSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      item: null,
      opening: null,
      warnings: [`Skipped entity: not a recognizable Brewfather ${kind} inventory item`],
    }
  }
  const bf = parsed.data

  if (!bf.name?.trim()) {
    return {
      item: null,
      opening: null,
      warnings: [`Skipped a ${kind} inventory item with no name`],
    }
  }
  const name = displayName(kind, bf, '')
  const label = `Inventory "${name}"`
  const warn = (msg: string) => warnings.push(`${label}: ${msg}`)

  const key = bf._id ?? `name:${name}`
  if (!bf._id) warn('no Brewfather _id — id derived from name (re-imports match by name)')
  const id = brewfatherId(`inventory-${kind}`, key)

  const { unit, factor } = resolveUnit(kind, bf.unit)
  if (unit === null) {
    warn(`skipped — unit "${bf.unit}" has no app equivalent`)
    return { item: null, opening: null, warnings }
  }
  if (kind === 'yeast' && bf.unit === undefined) {
    warn('no unit on yeast — defaulted to packets (Brewfather default)')
  }

  let amount = bf.inventory
  if (amount === undefined) {
    warn('on-hand amount missing — defaulted to 0')
    amount = 0
  } else if (amount < 0) {
    warn(`negative on-hand amount (${amount}) clamped to 0`)
    amount = 0
  }
  amount *= factor

  const item: InventoryItem = {
    id,
    name,
    ingredientKind: kind,
    amount,
    amountUnit: unit,
    status: 'sealed',
    notes_md: bf.notes ?? '',
    createdAt: opts.now,
    updatedAt: opts.now,
    schemaVersion: 1,
  }

  const vendor = bf.supplier?.trim() || bf.laboratory?.trim()
  if (vendor) item.vendor = vendor

  const bestBy = bfTimestampToIso(bf.bestBeforeDate)
  if (bestBy) item.bestByDate = bestBy

  // Price: only when the currency is clearly USD, or absent-but-numeric (warned).
  const cost = bf.costPerAmount
  if (cost !== undefined && cost >= 0) {
    const currency = (bf.currency ?? bf.costCurrency)?.trim().toUpperCase()
    if (currency === undefined || currency === '') {
      item.pricePerUnit_USD = cost
      warn('cost has no currency in the file — assumed USD')
    } else if (currency === 'USD') {
      item.pricePerUnit_USD = cost
    } else {
      warn(`cost in ${currency} not imported (app stores USD only)`)
    }
  }

  const validItem = InventoryItemSchema.safeParse(item)
  if (!validItem.success) {
    warn(
      `skipped — mapped item failed validation (${validItem.error.issues[0]?.message ?? 'unknown'})`,
    )
    return { item: null, opening: null, warnings }
  }

  // The ledger opening balance — written atomically with the item (repo-side)
  // so C1 (`amount === Σ deltas`) can never be left broken by a partial write.
  const opening = StockTransactionSchema.parse(
    buildStockTransaction({
      id: brewfatherId('opening', `inventory-${kind}:${key}`),
      item: validItem.data,
      delta: validItem.data.amount,
      reason: 'opening',
      at: opts.now,
      note: 'Brewfather import — opening balance',
    }),
  )

  return { item: validItem.data, opening, warnings }
}
