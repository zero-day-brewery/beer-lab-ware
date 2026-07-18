import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildBrewfatherPlan, executeBrewfatherImport } from '@/lib/brewing/brewfather/import'
import { runDataDoctor } from '@/lib/db/doctor'
import { BrewDB } from '@/lib/db/schema'

// A PAST timestamp: repos re-stamp `updatedAt` with the wall clock at save
// time, and RecipeSchema requires updatedAt >= createdAt — a future `now`
// here would make imported rows fail validation.
const NOW = '2026-01-01T00:00:00.000Z'
const FIXTURES = path.join(__dirname, '../../fixtures/brewfather')

function fixture(name: string): { fileName: string; text: string } {
  return { fileName: name, text: readFileSync(path.join(FIXTURES, name), 'utf-8') }
}

const allFiles = () => [
  fixture('recipes.json'),
  fixture('batches.json'),
  fixture('fermentables.json'),
  fixture('hops.json'),
  fixture('yeasts.json'),
  fixture('miscs.json'),
]

describe('executeBrewfatherImport', () => {
  let db: BrewDB
  beforeEach(async () => {
    db = new BrewDB('test-brewfather-import')
    await db.open()
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-brewfather-import')
  })

  it('writes recipes, inventory (+opening txns), batches, and readings', async () => {
    const plan = buildBrewfatherPlan(allFiles(), { now: NOW })
    const result = await executeBrewfatherImport(plan, db)

    expect(result.imported).toEqual({ recipes: 1, batches: 2, readings: 4, inventoryItems: 9 })
    expect(result.skippedExisting).toEqual({
      recipes: 0,
      batches: 0,
      readings: 0,
      inventoryItems: 0,
    })

    expect(await db.recipes.count()).toBe(1)
    expect(await db.batches.count()).toBe(2)
    expect(await db.readings.count()).toBe(4)
    expect(await db.inventoryItems.count()).toBe(9)
    // Every inventory item got exactly one opening ledger txn.
    expect(await db.stockTransactions.count()).toBe(9)
    const txns = await db.stockTransactions.toArray()
    expect(txns.every((t) => t.reason === 'opening')).toBe(true)
  })

  it('keeps the C1 ledger invariant and writes no orphans (doctor-clean)', async () => {
    const plan = buildBrewfatherPlan(allFiles(), { now: NOW })
    await executeBrewfatherImport(plan, db)

    const report = await runDataDoctor(db, db.verno)
    const byId = (id: string) => report.checks.find((c) => c.id === id)
    expect(byId('C1')?.ok).toBe(true) // amount === Σ deltas for every imported item
    expect(byId('C2')?.ok).toBe(true) // no orphan stock txns
    expect(byId('C3')?.ok).toBe(true) // no orphan readings
    expect(byId('C7')?.ok).toBe(true) // every row parses its schema
  })

  it('re-importing the same files duplicates nothing (idempotency)', async () => {
    const plan = buildBrewfatherPlan(allFiles(), { now: NOW })
    const first = await executeBrewfatherImport(plan, db)
    expect(first.imported.recipes).toBe(1)

    const again = buildBrewfatherPlan(allFiles(), { now: '2026-08-01T00:00:00.000Z' })
    const second = await executeBrewfatherImport(again, db)

    expect(second.imported).toEqual({ recipes: 0, batches: 0, readings: 0, inventoryItems: 0 })
    expect(second.skippedExisting).toEqual({
      recipes: 1,
      batches: 2,
      readings: 4,
      inventoryItems: 9,
    })
    // Table counts unchanged — including the ledger (no double opening balances).
    expect(await db.recipes.count()).toBe(1)
    expect(await db.batches.count()).toBe(2)
    expect(await db.readings.count()).toBe(4)
    expect(await db.inventoryItems.count()).toBe(9)
    expect(await db.stockTransactions.count()).toBe(9)
  })

  it('re-import never clobbers a user edit made since the first import', async () => {
    const plan = buildBrewfatherPlan(allFiles(), { now: NOW })
    await executeBrewfatherImport(plan, db)

    const recipe = (await db.recipes.toArray())[0]
    await db.recipes.update(recipe.id, { name: 'My Renamed IPA' })

    await executeBrewfatherImport(buildBrewfatherPlan(allFiles(), { now: NOW }), db)
    expect((await db.recipes.get(recipe.id))?.name).toBe('My Renamed IPA')
  })

  it('links imported batches to imported recipes by shared Brewfather _id', async () => {
    const plan = buildBrewfatherPlan(allFiles(), { now: NOW })
    await executeBrewfatherImport(plan, db)

    const recipes = await db.recipes.toArray()
    const batches = await db.batches.toArray()
    const hazyRecipe = recipes.find((r) => r.name === 'Hazy Horizon IPA')
    const hazyBatch = batches.find((b) => b.batchNo === 42)
    expect(hazyBatch?.recipeId).toBe(hazyRecipe?.id)
    expect(hazyBatch?.recipeSnapshot?.id).toBe(hazyRecipe?.id)
  })

  it('assigns local batch numbers when Brewfather carried none', async () => {
    const noNumber = JSON.stringify([
      { _id: 'bf-nn-1', status: 'Completed', recipe: { name: 'A', batchSize: 20, boilTime: 60 } },
      { _id: 'bf-nn-2', status: 'Completed', recipe: { name: 'B', batchSize: 20, boilTime: 60 } },
    ])
    const plan = buildBrewfatherPlan([{ fileName: 'batches.json', text: noNumber }], { now: NOW })
    await executeBrewfatherImport(plan, db)
    const nos = (await db.batches.toArray()).map((b) => b.batchNo).sort()
    expect(nos).toEqual([1, 2])
  })

  it('a malformed entity inside a valid file is skipped; the rest imports', async () => {
    const plan = buildBrewfatherPlan([fixture('malformed-recipes.json')], { now: NOW })
    const result = await executeBrewfatherImport(plan, db)
    expect(result.imported.recipes).toBe(1)
    expect(plan.warnings.length).toBeGreaterThan(0)
    expect(await db.recipes.count()).toBe(1)
  })
})
