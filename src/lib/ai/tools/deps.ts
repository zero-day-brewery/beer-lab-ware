/**
 * Injectable dependencies for the read-only tool registry.
 *
 * Each reader is a STRUCTURAL subset of a real repo (the repos have more methods;
 * we only ask for the read paths). Tests can pass fake readers backed by plain
 * arrays; production wires `defaultToolDeps` to the Dexie-backed singletons.
 *
 * `now` is injected (never `Date.now()` inside a tool) so the calc/report tools
 * that fold in "today" stay deterministic under test.
 */

import type { Batch } from '@/lib/brewing/types/batch'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { GearItem } from '@/lib/brewing/types/gear'
import type { Water } from '@/lib/brewing/types/ingredient'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { batchRepo } from '@/lib/db/repos/batch'
import { equipmentRepo } from '@/lib/db/repos/equipment'
import { gearRepo } from '@/lib/db/repos/gear'
import { inventoryRepo } from '@/lib/db/repos/inventory'
import { readingsRepo } from '@/lib/db/repos/readings'
import { recipeRepo } from '@/lib/db/repos/recipe'
import { waterRepo } from '@/lib/db/repos/water'

export interface RecipeReader {
  list(): Promise<Recipe[]>
  get(id: string): Promise<Recipe | null>
}
export interface InventoryReader {
  list(): Promise<InventoryItem[]>
}
export interface GearReader {
  list(): Promise<GearItem[]>
}
export interface BatchReader {
  list(): Promise<Batch[]>
  get(id: string): Promise<Batch | null>
}
export interface ReadingsReader {
  listByBatch(batchId: string): Promise<Reading[]>
}
export interface WaterReader {
  list(): Promise<Water[]>
  get(id: string): Promise<Water | null>
}
export interface EquipmentReader {
  list(): Promise<EquipmentProfile[]>
  get(id: string): Promise<EquipmentProfile | null>
  getDefault(): Promise<EquipmentProfile | null>
}

export interface ToolDeps {
  recipes: RecipeReader
  inventory: InventoryReader
  gear: GearReader
  batches: BatchReader
  readings: ReadingsReader
  water: WaterReader
  equipment: EquipmentReader
  /** Injected clock — the source of "now" for report/calc tools. */
  now: () => Date
}

/** Production deps: the Dexie-backed repo singletons + the real wall clock. */
export const defaultToolDeps: ToolDeps = {
  recipes: recipeRepo,
  inventory: inventoryRepo,
  gear: gearRepo,
  batches: batchRepo,
  readings: readingsRepo,
  water: waterRepo,
  equipment: equipmentRepo,
  now: () => new Date(),
}
