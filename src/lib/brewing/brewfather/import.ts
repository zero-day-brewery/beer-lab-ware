/**
 * Brewfather import orchestration.
 *
 *   1. `buildBrewfatherPlan` — PURE dry-run: parse + classify + map every file,
 *      dedupe by derived id, collect counts + warnings. This is the preview.
 *   2. `executeBrewfatherImport` — write the plan through the existing repos in
 *      dependency order: recipes → inventory items (atomically WITH their
 *      opening-balance ledger txns) → batches (+ recipe snapshots) → readings.
 *
 * Idempotency: every row id is a uuidv5 of the Brewfather `_id` (see ids.ts),
 * and execute skips any id that already exists — re-importing the same export
 * duplicates nothing and never overwrites rows the user may have edited since.
 */
import type { Batch } from '@/lib/brewing/types/batch'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { makeReadingsRepo } from '@/lib/db/repos/readings'
import { makeRecipeRepo } from '@/lib/db/repos/recipe'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { type BrewDB, db } from '@/lib/db/schema'
import { parseBrewfatherFile } from './classify'
import { mapBrewfatherBatch } from './map-batch'
import { type BfInventoryKind, mapBrewfatherInventoryItem } from './map-inventory'
import { mapBrewfatherRecipe } from './map-recipe'

export interface BrewfatherCounts {
  recipes: number
  batches: number
  readings: number
  inventoryItems: number
}

export interface PlannedBatch {
  batch: Batch
  needsBatchNo: boolean
  readings: Reading[]
}

export interface BrewfatherPlan {
  recipes: Recipe[]
  batches: PlannedBatch[]
  inventory: { item: InventoryItem; opening: StockTransaction }[]
  counts: BrewfatherCounts
  /** Entities present in the files but not mappable (skipped with a warning). */
  skippedEntities: number
  warnings: string[]
}

export interface BrewfatherImportResult {
  imported: BrewfatherCounts
  /** Rows whose derived id already existed locally (previous import) — untouched. */
  skippedExisting: BrewfatherCounts
  warnings: string[]
}

export interface BrewfatherFileInput {
  fileName: string
  text: string
}

const INVENTORY_KINDS: ReadonlySet<string> = new Set(['fermentable', 'hop', 'yeast', 'misc'])

const zeroCounts = (): BrewfatherCounts => ({
  recipes: 0,
  batches: 0,
  readings: 0,
  inventoryItems: 0,
})

/**
 * PURE dry-run over one or more Brewfather JSON files: nothing is written.
 * Entities appearing more than once (same file selected twice, or the same
 * entity in two files) are deduped by their derived id.
 */
export function buildBrewfatherPlan(
  files: readonly BrewfatherFileInput[],
  opts?: { now?: string },
): BrewfatherPlan {
  const now = opts?.now ?? new Date().toISOString()
  const warnings: string[] = []
  let skippedEntities = 0

  const recipes = new Map<string, Recipe>()
  const batches = new Map<string, PlannedBatch>()
  const inventory = new Map<string, { item: InventoryItem; opening: StockTransaction }>()

  for (const file of files) {
    const parsed = parseBrewfatherFile(file.fileName, file.text)
    warnings.push(...parsed.warnings)
    skippedEntities += parsed.warnings.filter((w) => w.includes('Entity #')).length

    for (const entity of parsed.entities) {
      if (entity.kind === 'recipe') {
        const mapped = mapBrewfatherRecipe(entity.raw, { now })
        warnings.push(...mapped.warnings)
        if (mapped.recipe) recipes.set(mapped.recipe.id, mapped.recipe)
        else skippedEntities += 1
      } else if (entity.kind === 'batch') {
        const mapped = mapBrewfatherBatch(entity.raw, { now })
        warnings.push(...mapped.warnings)
        if (mapped.batch) {
          batches.set(mapped.batch.id, {
            batch: mapped.batch,
            needsBatchNo: mapped.needsBatchNo,
            readings: mapped.readings,
          })
        } else {
          skippedEntities += 1
        }
      } else if (INVENTORY_KINDS.has(entity.kind)) {
        const mapped = mapBrewfatherInventoryItem(entity.raw, entity.kind as BfInventoryKind, {
          now,
        })
        warnings.push(...mapped.warnings)
        if (mapped.item && mapped.opening) {
          inventory.set(mapped.item.id, { item: mapped.item, opening: mapped.opening })
        } else {
          skippedEntities += 1
        }
      }
    }
  }

  const plannedBatches = [...batches.values()]
  return {
    recipes: [...recipes.values()],
    batches: plannedBatches,
    inventory: [...inventory.values()],
    counts: {
      recipes: recipes.size,
      batches: batches.size,
      readings: plannedBatches.reduce((n, b) => n + b.readings.length, 0),
      inventoryItems: inventory.size,
    },
    skippedEntities,
    warnings,
  }
}

/**
 * Write a plan through the existing repos, in dependency order. Per-entity
 * failures are collected as warnings — one bad row never aborts the import.
 */
export async function executeBrewfatherImport(
  plan: BrewfatherPlan,
  database: BrewDB = db,
): Promise<BrewfatherImportResult> {
  const recipeRepo = makeRecipeRepo(database)
  const batchRepo = makeBatchRepo(database)
  const readingsRepo = makeReadingsRepo(database)
  const stockRepo = makeStockTransactionsRepo(database)

  const imported = zeroCounts()
  const skippedExisting = zeroCounts()
  const warnings: string[] = []

  // 1. Recipes.
  for (const recipe of plan.recipes) {
    try {
      if (await database.recipes.get(recipe.id)) {
        skippedExisting.recipes += 1
        continue
      }
      await recipeRepo.save(recipe)
      imported.recipes += 1
    } catch (err) {
      warnings.push(`Recipe "${recipe.name}" failed to save: ${(err as Error).message}`)
    }
  }

  // 2. Inventory items — atomically with their opening-balance ledger txn, so
  //    the C1 invariant (`amount === Σ deltas`) holds even on a partial failure.
  for (const { item, opening } of plan.inventory) {
    try {
      if (await database.inventoryItems.get(item.id)) {
        skippedExisting.inventoryItems += 1
        continue
      }
      await stockRepo.saveItemWithTxn(item, opening)
      imported.inventoryItems += 1
    } catch (err) {
      warnings.push(`Inventory "${item.name}" failed to save: ${(err as Error).message}`)
    }
  }

  // 3. Batches (+ recipe snapshots). Batches lacking a Brewfather batch number
  //    get the next local numbers, assigned in plan order.
  let nextNo = await batchRepo.nextBatchNo()
  const batchIdsPresent = new Set<string>()
  for (const planned of plan.batches) {
    try {
      if (await database.batches.get(planned.batch.id)) {
        skippedExisting.batches += 1
        batchIdsPresent.add(planned.batch.id)
        continue
      }
      const batch = planned.needsBatchNo ? { ...planned.batch, batchNo: nextNo++ } : planned.batch
      await batchRepo.save(batch)
      imported.batches += 1
      batchIdsPresent.add(batch.id)
    } catch (err) {
      warnings.push(`Batch "${planned.batch.name}" failed to save: ${(err as Error).message}`)
    }
  }

  // 4. Readings — only for batches that actually exist (imported now or
  //    already present), so an orphan reading (doctor C3) can never be written.
  for (const planned of plan.batches) {
    if (planned.readings.length === 0) continue
    if (!batchIdsPresent.has(planned.batch.id)) {
      warnings.push(
        `Skipped ${planned.readings.length} reading(s) for "${planned.batch.name}" — batch was not imported`,
      )
      continue
    }
    for (const reading of planned.readings) {
      try {
        if (await database.readings.get(reading.id)) {
          skippedExisting.readings += 1
          continue
        }
        await readingsRepo.create(reading)
        imported.readings += 1
      } catch (err) {
        warnings.push(
          `A reading for "${planned.batch.name}" failed to save: ${(err as Error).message}`,
        )
      }
    }
  }

  return { imported, skippedExisting, warnings }
}
