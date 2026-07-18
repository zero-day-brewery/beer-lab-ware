/**
 * Permissive Zod schemas for Brewfather JSON exports (Settings → Export all
 * data, or per-entity export). Brewfather's format is versioned by them, not
 * us, so every field is OPTIONAL-FIRST and individually `.catch(undefined)`:
 * a field of the wrong type reads as "missing" instead of failing the entity,
 * and unknown fields are ignored (plain z.object strips them). The mappers own
 * all semantic decisions (defaults, skips, warnings) — these schemas only
 * guarantee shape safety.
 */
import { z } from 'zod'

/** Wrong-type-tolerant field helpers: bad values degrade to `undefined`. */
const num = z.number().finite().optional().catch(undefined)
const str = z.string().optional().catch(undefined)
const strArray = z.array(z.string()).optional().catch(undefined)
/** Arrays of entities stay `unknown[]` — one malformed element must only skip
 *  that element (mapper-side), never drop the whole array via a schema catch. */
const unknownArray = z.array(z.unknown()).optional().catch(undefined)

/**
 * Brewfather timestamps appear as epoch milliseconds (numbers), ISO strings,
 * or Firestore `{ _seconds, _nanoseconds }` objects depending on export path.
 */
const timestamp = z
  .union([z.number(), z.string(), z.object({ _seconds: z.number() })])
  .optional()
  .catch(undefined)
export type BfTimestamp = z.infer<typeof timestamp>

/** Convert any accepted Brewfather timestamp shape to an ISO string, else undefined. */
export function bfTimestampToIso(v: BfTimestamp): string | undefined {
  let ms: number | undefined
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    // Epoch ms in the 2000s is ~1e12; epoch seconds ~1e9. Treat small values as seconds.
    ms = v > 1e11 ? v : v * 1000
  } else if (typeof v === 'string') {
    const t = new Date(v).getTime()
    if (!Number.isNaN(t)) ms = t
  } else if (typeof v === 'object' && v !== null && Number.isFinite(v._seconds)) {
    ms = v._seconds * 1000
  }
  if (ms === undefined) return undefined
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// ── Recipe ingredient lines ─────────────────────────────────────────────────

export const BfFermentableSchema = z.object({
  _id: str,
  name: str,
  type: str,
  amount: num, // kg (Brewfather is metric-native)
  potential: num, // SG, e.g. 1.037
  potentialPercentage: num, // % yield
  color: num, // Lovibond (Brewfather stores fermentable color in °L)
  lovibond: num,
})
export type BfFermentable = z.infer<typeof BfFermentableSchema>

export const BfHopSchema = z.object({
  _id: str,
  name: str,
  alpha: num, // % alpha acid
  amount: num, // g
  use: str, // "Boil" | "Dry Hop" | "Aroma" | "First Wort" | "Mash" | ...
  time: num, // minutes for boil-side uses; dry-hop duration units are ambiguous
  type: str, // "Pellet" | "Leaf" | ...
})
export type BfHop = z.infer<typeof BfHopSchema>

export const BfYeastSchema = z.object({
  _id: str,
  name: str,
  type: str,
  form: str, // "Dry" | "Liquid" | ...
  amount: num,
  unit: str, // "pkg" | "g" | "ml" | "l"
  attenuation: num,
  minAttenuation: num,
  maxAttenuation: num,
  laboratory: str,
  productId: str,
})
export type BfYeast = z.infer<typeof BfYeastSchema>

export const BfMiscSchema = z.object({
  _id: str,
  name: str,
  type: str,
  use: str,
  amount: num,
  unit: str,
  time: num,
})
export type BfMisc = z.infer<typeof BfMiscSchema>

export const BfMashStepSchema = z.object({
  name: str,
  type: str, // "Temperature" | "Infusion" | "Decoction"
  stepTemp: num, // °C
  stepTime: num, // min
  rampTime: num, // min
})
export type BfMashStep = z.infer<typeof BfMashStepSchema>

// ── Recipe ──────────────────────────────────────────────────────────────────

export const BfRecipeSchema = z.object({
  _id: str,
  name: str,
  type: str, // "All Grain" | "Extract" | "Partial Mash"
  batchSize: num, // L
  boilTime: num, // min
  og: num,
  fg: num,
  abv: num,
  ibu: num,
  color: num, // EBC (recipe-level color is EBC; fermentable color is °L)
  notes: str,
  tags: strArray,
  style: z.object({ name: str }).optional().catch(undefined),
  fermentables: unknownArray,
  hops: unknownArray,
  yeasts: unknownArray,
  miscs: unknownArray,
  mash: z.object({ steps: unknownArray }).optional().catch(undefined),
  // Present-but-unsupported sections (detected only to surface a warning):
  equipment: z.record(z.string(), z.unknown()).optional().catch(undefined),
  fermentation: z.record(z.string(), z.unknown()).optional().catch(undefined),
  water: z.record(z.string(), z.unknown()).optional().catch(undefined),
  created: timestamp,
})
export type BfRecipe = z.infer<typeof BfRecipeSchema>

// ── Batch ───────────────────────────────────────────────────────────────────

export const BfReadingSchema = z.object({
  time: timestamp,
  timestamp: timestamp,
  sg: num,
  gravity: num,
  temp: num, // °C
  ph: num,
  comment: str,
  note: str,
})
export type BfReading = z.infer<typeof BfReadingSchema>

export const BfBatchSchema = z.object({
  _id: str,
  batchNo: num,
  name: str,
  status: str, // "Planning" | "Brewing" | "Fermenting" | "Conditioning" | "Completed" | "Archived"
  brewDate: timestamp,
  bottlingDate: timestamp,
  fermentationStartDate: timestamp,
  measuredOg: num,
  measuredFg: num,
  measuredAbv: num,
  measuredMashPh: num,
  measuredBoilSize: num, // L, pre-boil volume
  measuredBatchSize: num, // L, into fermenter
  measuredPreBoilGravity: num,
  measuredEfficiency: num, // % brewhouse
  batchNotes: str,
  recipe: z.unknown().optional(), // embedded full recipe → recipeSnapshot
  readings: unknownArray,
})
export type BfBatch = z.infer<typeof BfBatchSchema>

// ── Inventory ───────────────────────────────────────────────────────────────

export const BfInventoryItemSchema = z.object({
  _id: str,
  name: str,
  type: str,
  inventory: num, // on-hand amount (kg fermentables / g hops / pkg yeast)
  unit: str,
  alpha: num,
  attenuation: num,
  laboratory: str,
  productId: str,
  supplier: str,
  potential: num,
  potentialPercentage: num,
  costPerAmount: num,
  currency: str,
  costCurrency: str,
  bestBeforeDate: timestamp,
  notes: str,
  use: str,
})
export type BfInventoryItem = z.infer<typeof BfInventoryItemSchema>
