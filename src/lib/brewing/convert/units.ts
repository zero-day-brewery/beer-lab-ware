import { gToOz, kgToLb, lbToKg, ozToG } from './mass'
import { lToMl, mlToL } from './volume'

/**
 * Physical dimension of a stock unit. Deduction can only convert WITHIN a
 * dimension — mass↔mass, volume↔volume, count↔count. Cross-dimension is
 * intentionally unconvertible (returns null) — we never guess a density.
 */
export type Dimension = 'mass' | 'volume' | 'count'

type MassUnit = 'g' | 'kg' | 'oz' | 'lb'
type VolumeUnit = 'ml' | 'mL' | 'l' | 'L'

/**
 * The dimension of a unit string, or `null` when it has no fixed physical
 * dimension for inventory purposes.
 *
 * `tsp`/`tbsp` are deliberately null: a teaspoon of a fining and a teaspoon of a
 * salt weigh (and displace) different amounts, so converting them to the item's
 * g/ml stock unit would require a density we don't track. Returning null forces
 * the review to flag those lines for manual resolution instead of guessing.
 *
 * Mass base = g, volume base = ml, count base = each (packets ≡ each, 1:1).
 */
export function dimensionOf(unit: string): Dimension | null {
  switch (unit) {
    case 'g':
    case 'kg':
    case 'oz':
    case 'lb':
      return 'mass'
    case 'ml':
    case 'mL':
    case 'l':
    case 'L':
      return 'volume'
    case 'each':
    case 'packets':
      return 'count'
    default:
      // tsp, tbsp, and any unknown unit → not convertible without more info.
      return null
  }
}

const isLiter = (u: string): boolean => u === 'L' || u === 'l'

/** Mass → grams (base). Reuses convert/mass.ts; g↔kg is the trivial ×1000. */
function toGrams(amount: number, unit: MassUnit): number {
  switch (unit) {
    case 'g':
      return amount
    case 'kg':
      return amount * 1000
    case 'oz':
      return ozToG(amount)
    case 'lb':
      return lbToKg(amount) * 1000
  }
}

/** Grams (base) → mass unit. Inverse of {@link toGrams}. */
function fromGrams(grams: number, unit: MassUnit): number {
  switch (unit) {
    case 'g':
      return grams
    case 'kg':
      return grams / 1000
    case 'oz':
      return gToOz(grams)
    case 'lb':
      return kgToLb(grams / 1000)
  }
}

/** Volume → millilitres (base). Reuses convert/volume.ts for L↔ml. */
function toMl(amount: number, unit: VolumeUnit): number {
  return isLiter(unit) ? lToMl(amount) : amount
}

/** Millilitres (base) → volume unit. Inverse of {@link toMl}. */
function fromMl(ml: number, unit: VolumeUnit): number {
  return isLiter(unit) ? mlToL(ml) : ml
}

/**
 * Convert `amount` from unit `from` to unit `to`, or `null` when the two units
 * live in different dimensions (or either is dimensionless like tsp/tbsp).
 *
 * Pure. Same-unit is an identity pass-through; every real conversion routes
 * through the dimension's base unit (g / ml / each) using the existing
 * `convert/mass.ts` + `convert/volume.ts` primitives, so there is exactly one
 * source of truth for the physical factors.
 */
export function convertAmount(amount: number, from: string, to: string): number | null {
  const dimFrom = dimensionOf(from)
  const dimTo = dimensionOf(to)
  if (dimFrom === null || dimTo === null) return null
  if (dimFrom !== dimTo) return null
  if (from === to) return amount
  switch (dimFrom) {
    case 'mass':
      return fromGrams(toGrams(amount, from as MassUnit), to as MassUnit)
    case 'volume':
      return fromMl(toMl(amount, from as VolumeUnit), to as VolumeUnit)
    case 'count':
      // each ≡ packets, 1:1 — no scaling.
      return amount
  }
}
