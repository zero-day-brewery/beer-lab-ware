import { z } from 'zod'

/**
 * A **YeastLot** — one physical package of yeast (a smack-pack, a vial, a
 * measured slurry) tracked at the lot level because yeast is alive and
 * degrades: each lot has its own production/harvest date and its own live-cell
 * count. This is a first-class entity (its own Dexie store) rather than a
 * fungible `InventoryItem.amount`, because the pitch decision depends on the
 * age + viability of the *specific* lot you reach for (see the FIFO-viable
 * selection engine in `inventory/yeast-selection.ts`).
 *
 * `productionDate` is the single FIFO + viability reference date. Its real-world
 * meaning depends on `form`: manufacture date for `dry`/`liquid`, harvest date
 * for `slurry`. One field keeps age math + FIFO ordering simple.
 *
 * Additive to the schema (Dexie v9, new store) — nothing existing changes.
 */

export const YeastFormSchema = z.enum(['dry', 'liquid', 'slurry'])
export type YeastForm = z.infer<typeof YeastFormSchema>

/** Unit of the on-hand `quantity`: whole packs/vials, or mL/g of slurry. */
export const YeastLotUnitSchema = z.enum(['packet', 'vial', 'mL', 'g'])
export type YeastLotUnit = z.infer<typeof YeastLotUnitSchema>

export const YeastLotSchema = z.object({
  id: z.string().uuid(),
  /** Display name, e.g. "WLP001 California Ale". */
  name: z.string().min(1, 'Name is required'),
  /** Strain name used to match a recipe's yeast (case-insensitive), e.g. "California Ale". */
  strain: z.string().min(1, 'Strain is required'),
  /** Optional lab/product id, e.g. "WLP001" / "Wyeast 1056" / "US-05". */
  labId: z.string().optional(),
  /** The lot this slurry was harvested from. Absent ⇒ acquired, not harvested (origin derived from presence). */
  parentLotId: z.string().uuid().optional(),
  /** The batch the slurry came out of. */
  harvestedFromBatchId: z.string().uuid().optional(),
  form: YeastFormSchema,
  /**
   * FIFO + viability reference date (ISO). mfg date for dry/liquid, harvest date
   * for slurry. The oldest still-viable lot is used first.
   */
  productionDate: z.string().datetime(),
  /** Live cells at production, in billions (package rating, or estimate for slurry). */
  initialCells_B: z.number().positive(),
  /**
   * A direct viable-cell count (billions), already viability-discounted — e.g. a
   * hemocytometer reading. When present with `measuredAt`, it OVERRIDES the crude
   * age-based estimate in `viableCells()`, decaying forward from `measuredAt` at
   * the form's slope. "Latest only": a new measurement overwrites the prior one.
   * The age-based `currentViability()` % bar deliberately stays estimate-based.
   */
  measuredViableCells_B: z.number().positive().optional(),
  /** When `measuredViableCells_B` was counted (ISO). Re-anchors the decay curve. */
  measuredAt: z.string().datetime().optional(),
  /** 0 = fresh pitch; N = Nth repitch of harvested slurry. Optional realism (v2 uses it more). */
  generation: z.number().int().nonnegative().default(0),
  /** On-hand quantity (count of packs/vials, or mL/g of slurry). */
  quantity: z.number().nonnegative(),
  unit: YeastLotUnitSchema,
  /** Vendor, or the batch it was harvested from. */
  source: z.string().optional(),
  notes_md: z.string().default(''),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
})

export type YeastLot = z.infer<typeof YeastLotSchema>

/** Is this lot still on hand (has stock to pitch)? */
export function isInStock(lot: YeastLot): boolean {
  return lot.quantity > 0
}
