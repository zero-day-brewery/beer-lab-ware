import type { Recipe } from '@/lib/brewing/types/recipe'
import type { FermentableUse, HopUse, MiscUse, YeastUse } from '@/lib/brewing/types/recipe-parts'

/** A changed scalar field (batch size, boil time, or a vital-stat target). */
export interface FieldChange {
  label: string
  from?: string | number
  to?: string | number
}

export type IngredientKind = 'fermentable' | 'hop' | 'yeast' | 'misc'

/** A changed ingredient use — added, removed, or an amount/time delta. */
export interface IngredientChange {
  kind: IngredientKind
  key: string
  name: string
  change: 'added' | 'removed' | 'amount'
  from?: string
  to?: string
}

export interface RecipeDiff {
  fields: FieldChange[]
  ingredients: IngredientChange[]
  isEmpty: boolean
}

const TARGET_KEYS = ['OG', 'FG', 'ABV', 'IBU', 'SRM'] as const

type Use = { ingredientId: string; snapshot: { name: string } }

/** Stable identity for an ingredient use — the detail view's React-key convention. */
function keyOf(u: Use): string {
  return `${u.ingredientId}:${u.snapshot.name}`
}

// Canonical amount strings. Numeric amounts render with `.toFixed(3)` so the
// comparison carries a built-in float epsilon (5.000 vs 5.0004 → equal), matching
// how the brew-sheet tables format quantities.
function fermValue(u: FermentableUse): string {
  return `${u.amount_kg.toFixed(3)} kg`
}
function hopValue(u: HopUse): string {
  return `${u.amount_g.toFixed(3)} g @ ${u.time_min} min`
}
function yeastValue(u: YeastUse): string {
  return u.amount.toFixed(3)
}
function miscValue(u: MiscUse): string {
  return `${u.amount.toFixed(3)} ${u.amountUnit}`
}

function diffUses<T extends Use>(
  kind: IngredientKind,
  prev: T[],
  next: T[],
  value: (u: T) => string,
): IngredientChange[] {
  const prevMap = new Map(prev.map((u): [string, T] => [keyOf(u), u]))
  const nextMap = new Map(next.map((u): [string, T] => [keyOf(u), u]))
  const out: IngredientChange[] = []

  // Added + amount/time-changed, in the new recipe's order.
  for (const [key, u] of nextMap) {
    const before = prevMap.get(key)
    if (!before) {
      out.push({ kind, key, name: u.snapshot.name, change: 'added', to: value(u) })
      continue
    }
    const from = value(before)
    const to = value(u)
    if (from !== to) {
      out.push({ kind, key, name: u.snapshot.name, change: 'amount', from, to })
    }
  }

  // Removed — present before, gone now (in the old recipe's order).
  for (const [key, u] of prevMap) {
    if (!nextMap.has(key)) {
      out.push({ kind, key, name: u.snapshot.name, change: 'removed', from: value(u) })
    }
  }

  return out
}

/**
 * Pure diff between two recipe versions (`prev` → `next`). Emits a `fields` line
 * only for changed scalars (batch size, boil time, each vital-stat target) and an
 * `ingredients` line per added / removed / amount-changed use, keyed by
 * `${ingredientId}:${snapshot.name}`. No DOM / Dexie / Date — unit-tested.
 */
export function diffRecipes(prev: Recipe, next: Recipe): RecipeDiff {
  const fields: FieldChange[] = []

  if (prev.batchSize_L !== next.batchSize_L) {
    fields.push({ label: 'Batch size', from: prev.batchSize_L, to: next.batchSize_L })
  }
  if (prev.boilTime_min !== next.boilTime_min) {
    fields.push({ label: 'Boil time', from: prev.boilTime_min, to: next.boilTime_min })
  }
  for (const k of TARGET_KEYS) {
    const from = prev.targets?.[k]
    const to = next.targets?.[k]
    if (from !== to) fields.push({ label: k, from, to })
  }

  const ingredients = [
    ...diffUses('fermentable', prev.fermentables, next.fermentables, fermValue),
    ...diffUses('hop', prev.hops, next.hops, hopValue),
    ...diffUses('yeast', prev.yeasts, next.yeasts, yeastValue),
    ...diffUses('misc', prev.miscs, next.miscs, miscValue),
  ]

  return { fields, ingredients, isEmpty: fields.length === 0 && ingredients.length === 0 }
}
