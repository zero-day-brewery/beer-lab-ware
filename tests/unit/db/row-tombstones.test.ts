/**
 * Deletion tombstones — every repo delete path (see db/repos/*.ts) writes a
 * `RowTombstone` in the SAME Dexie transaction as the delete itself, so the
 * sync merge (sync/merge.ts) can tell "deleted elsewhere" apart from "never
 * existed here" and stop a resurrection. Covers every repo enumerated by
 * reading db/repos/*.ts: recipe, batch, inventory (+ cascade to its ledger),
 * gear, water, readings, yeast-lots, session, equipment, ingredient, timer
 * (+ its session cascade), stock-transactions (cascade helper used
 * standalone). `seedTombstones` (a separate, older mechanism — see
 * inventory/gear/equipment repos) is untouched by this feature; verified
 * still-independent below.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { GearItem } from '@/lib/brewing/types/gear'
import type { Water } from '@/lib/brewing/types/ingredient'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Reading } from '@/lib/brewing/types/reading'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { makeEquipmentRepo } from '@/lib/db/repos/equipment'
import { makeGearRepo } from '@/lib/db/repos/gear'
import { makeIngredientRepo } from '@/lib/db/repos/ingredient'
import { makeInventoryRepo } from '@/lib/db/repos/inventory'
import { makeReadingsRepo } from '@/lib/db/repos/readings'
import { makeRecipeRepo } from '@/lib/db/repos/recipe'
import { makeSessionRepo } from '@/lib/db/repos/session'
import { makeStockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { makeTimerRepo } from '@/lib/db/repos/timer'
import { makeWaterRepo } from '@/lib/db/repos/water'
import { makeYeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { BrewDB } from '@/lib/db/schema'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`row-tombstones-${Date.now()}-${n++}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})

async function expectTombstoned(db: BrewDB, id: string, table: string): Promise<void> {
  const t = await db.rowTombstones.get(id)
  expect(t, `expected a rowTombstone for ${table}:${id}`).toBeDefined()
  expect(t?.table).toBe(table)
  expect(Number.isNaN(Date.parse(t?.deletedAt ?? ''))).toBe(false)
}

function recipe(over: Partial<Recipe> & { id: string }): Recipe {
  return {
    name: 'Pale Ale',
    type: 'all-grain',
    batchSize_L: 19,
    boilTime_min: 60,
    equipmentProfileId: crypto.randomUUID(),
    fermentables: [],
    hops: [],
    yeasts: [],
    miscs: [],
    mashSteps: [],
    notes_md: '',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

// Batch/EquipmentProfile/Ingredient/BrewSession/BrewTimer have many fields —
// these tests only exercise the delete()/tombstone path (Dexie never
// validates a `.put()`), so build minimal loosely-typed rows rather than
// hand-authoring every Zod-required field.
function batch(over: { id: string; recipeId?: string }): Record<string, unknown> {
  return {
    batchNo: 1,
    name: 'Batch 1',
    status: 'complete',
    process: [],
    logs: [],
    timers: [],
    results: {},
    tasting: {},
    startedAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function invItem(over: Partial<InventoryItem> & { id: string }): InventoryItem {
  return {
    name: 'Cascade',
    ingredientKind: 'hop',
    amount: 100,
    amountUnit: 'g',
    status: 'sealed',
    notes_md: '',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function txn(
  over: Partial<StockTransaction> & { id: string; inventoryItemId: string },
): StockTransaction {
  return {
    kind: 'hop',
    delta: 100,
    unit: 'g',
    reason: 'opening',
    at: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function gear(over: Partial<GearItem> & { id: string }): GearItem {
  return {
    name: 'Auto-siphon',
    category: 'other',
    condition: 'good',
    notes_md: '',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function water(over: Partial<Water> & { id: string }): Water {
  return {
    kind: 'water',
    name: 'RO',
    Ca_ppm: 5,
    Mg_ppm: 1,
    Na_ppm: 2,
    SO4_ppm: 3,
    Cl_ppm: 4,
    HCO3_ppm: 5,
    ...over,
  }
}

function reading(over: Partial<Reading> & { id: string; batchId: string }): Reading {
  return {
    at: '2026-05-01T00:00:00.000Z',
    gravity: 1.04,
    schemaVersion: 1,
    ...over,
  }
}

function lot(over: Partial<YeastLot> & { id: string }): YeastLot {
  return {
    name: 'WLP001',
    strain: 'California Ale',
    form: 'liquid',
    productionDate: '2026-05-01T00:00:00.000Z',
    initialCells_B: 100,
    generation: 0,
    quantity: 1,
    unit: 'vial',
    notes_md: '',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

function equipment(over: { id: string }): Record<string, unknown> {
  return {
    name: 'B40pro',
    isDefault: false,
    schemaVersion: 1,
    ...over,
  }
}

function ingredient(over: { id: string }): Record<string, unknown> {
  return {
    kind: 'hop',
    name: 'Cascade',
    alphaAcid_pct: 6.5,
    beta_pct: 4,
    type: 'dual',
    substitutes: [],
    origin: '',
    notes_md: '',
    ...over,
  }
}

describe('recipeRepo.delete', () => {
  it('tombstones the recipe in the same transaction as the delete', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.recipes.put(recipe({ id }))
    await makeRecipeRepo(db).delete(id)
    expect(await db.recipes.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'recipes')
  })
})

describe('batchRepo.delete', () => {
  it('tombstones the batch in the same transaction as the delete', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.batches.put(batch({ id }) as never)
    await makeBatchRepo(db).delete(id)
    expect(await db.batches.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'batches')
  })
})

describe('inventoryRepo.delete', () => {
  it('tombstones the item AND writes the seedTombstone (both mechanisms, unmerged)', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.inventoryItems.put(invItem({ id }))
    await makeInventoryRepo(db).delete(id)
    expect(await db.inventoryItems.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'inventoryItems')
    expect(await db.seedTombstones.get(id)).toEqual({ id }) // pre-existing mechanism, untouched
  })

  it('CASCADES: deleting the item also deletes AND tombstones every one of its ledger rows, atomically', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    const txnA = crypto.randomUUID()
    const txnB = crypto.randomUUID()
    const otherItemId = crypto.randomUUID()
    const otherTxn = crypto.randomUUID()
    await db.inventoryItems.put(invItem({ id }))
    await db.stockTransactions.bulkPut([
      txn({ id: txnA, inventoryItemId: id }),
      txn({ id: txnB, inventoryItemId: id, reason: 'brew-deduct', delta: -10 }),
      txn({ id: otherTxn, inventoryItemId: otherItemId }), // untouched — different item
    ])

    await makeInventoryRepo(db).delete(id)

    expect(await db.stockTransactions.get(txnA)).toBeUndefined()
    expect(await db.stockTransactions.get(txnB)).toBeUndefined()
    expect(await db.stockTransactions.get(otherTxn)).toBeDefined() // sibling item's ledger untouched
    await expectTombstoned(db, txnA, 'stockTransactions')
    await expectTombstoned(db, txnB, 'stockTransactions')
    expect(await db.rowTombstones.get(otherTxn)).toBeUndefined()
  })

  it('CASCADE is a no-op (no crash) when the item has no ledger rows', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.inventoryItems.put(invItem({ id }))
    await expect(makeInventoryRepo(db).delete(id)).resolves.toBeUndefined()
    await expectTombstoned(db, id, 'inventoryItems')
  })
})

describe('gearRepo.delete', () => {
  it('tombstones the item AND writes the seedTombstone', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.gearItems.put(gear({ id }))
    await makeGearRepo(db).delete(id)
    expect(await db.gearItems.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'gearItems')
    expect(await db.seedTombstones.get(id)).toEqual({ id })
  })
})

describe('waterRepo.delete', () => {
  it('tombstones the profile', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.waterProfiles.put(water({ id }))
    await makeWaterRepo(db).delete(id)
    expect(await db.waterProfiles.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'waterProfiles')
  })
})

describe('readingsRepo.delete', () => {
  it('tombstones the reading', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.readings.put(reading({ id, batchId: crypto.randomUUID() }))
    await makeReadingsRepo(db).delete(id)
    expect(await db.readings.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'readings')
  })
})

describe('yeastLotsRepo.remove', () => {
  it('tombstones the lot', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.yeastLots.put(lot({ id }))
    await makeYeastLotsRepo(db).remove(id)
    expect(await db.yeastLots.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'yeastLots')
  })
})

describe('sessionRepo.delete', () => {
  it('tombstones the session', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.brewSessions.put({
      id,
      recipeId: crypto.randomUUID(),
      lifecycle: 'running',
      updatedAt: '2026-05-01T00:00:00.000Z',
    } as never)
    await makeSessionRepo(db).delete(id)
    expect(await db.brewSessions.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'brewSessions')
  })
})

describe('equipmentRepo.delete', () => {
  it('tombstones the profile AND writes the seedTombstone', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.equipmentProfiles.put(equipment({ id }) as never)
    await makeEquipmentRepo(db).delete(id)
    expect(await db.equipmentProfiles.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'equipmentProfiles')
    expect(await db.seedTombstones.get(id)).toEqual({ id })
  })
})

describe('ingredientRepo.delete', () => {
  it('tombstones the ingredient', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.ingredients.put(ingredient({ id }) as never)
    await makeIngredientRepo(db).delete(id)
    expect(await db.ingredients.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'ingredients')
  })
})

describe('timerRepo.delete / deleteBySession', () => {
  it('delete() tombstones a single timer', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.brewTimers.put({
      id,
      sessionId: crypto.randomUUID(),
      stepId: 's1',
      label: 'Mash',
      durationMin: 60,
      fireAt: '2026-05-01T00:00:00.000Z',
      status: 'armed',
      isBoilMaster: false,
    } as never)
    await makeTimerRepo(db).delete(id)
    expect(await db.brewTimers.get(id)).toBeUndefined()
    await expectTombstoned(db, id, 'brewTimers')
  })

  it('deleteBySession() cascades: every timer for the session is deleted AND tombstoned', async () => {
    const db = freshDb()
    const sessionId = crypto.randomUUID()
    const t1 = crypto.randomUUID()
    const t2 = crypto.randomUUID()
    const otherSession = crypto.randomUUID()
    const t3 = crypto.randomUUID()
    const mk = (id: string, sid: string) =>
      ({
        id,
        sessionId: sid,
        stepId: 's1',
        label: 'Mash',
        durationMin: 60,
        fireAt: '2026-05-01T00:00:00.000Z',
        status: 'armed',
        isBoilMaster: false,
      }) as never
    await db.brewTimers.bulkPut([mk(t1, sessionId), mk(t2, sessionId), mk(t3, otherSession)])

    await makeTimerRepo(db).deleteBySession(sessionId)

    expect(await db.brewTimers.get(t1)).toBeUndefined()
    expect(await db.brewTimers.get(t2)).toBeUndefined()
    expect(await db.brewTimers.get(t3)).toBeDefined() // different session, untouched
    await expectTombstoned(db, t1, 'brewTimers')
    await expectTombstoned(db, t2, 'brewTimers')
    expect(await db.rowTombstones.get(t3)).toBeUndefined()
  })
})

describe('stockTransactionsRepo.deleteByItem (used standalone, not only via the inventory cascade)', () => {
  it('deletes AND tombstones every txn for the item', async () => {
    const db = freshDb()
    const itemId = crypto.randomUUID()
    const t1 = crypto.randomUUID()
    const t2 = crypto.randomUUID()
    await db.stockTransactions.bulkPut([
      txn({ id: t1, inventoryItemId: itemId }),
      txn({ id: t2, inventoryItemId: itemId, reason: 'brew-deduct', delta: -5 }),
    ])
    await makeStockTransactionsRepo(db).deleteByItem(itemId)
    expect(await db.stockTransactions.get(t1)).toBeUndefined()
    expect(await db.stockTransactions.get(t2)).toBeUndefined()
    await expectTombstoned(db, t1, 'stockTransactions')
    await expectTombstoned(db, t2, 'stockTransactions')
  })

  it('is a no-op (no crash, no tombstones) when the item has no ledger rows', async () => {
    const db = freshDb()
    await expect(
      makeStockTransactionsRepo(db).deleteByItem(crypto.randomUUID()),
    ).resolves.toBeUndefined()
    expect(await db.rowTombstones.count()).toBe(0)
  })
})
