import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calculateRecipe } from '@/lib/brewing/calc/pipeline'
import { B40PRO_PROFILE } from '@/lib/brewing/defaults/b40pro'
import type { Batch } from '@/lib/brewing/types/batch'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { makeBackupService } from '@/lib/db/backup'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { makeSettingsRepo } from '@/lib/db/repos/settings'
import { BrewDB } from '@/lib/db/schema'

describe('backup service', () => {
  let db: BrewDB
  let backup: ReturnType<typeof makeBackupService>

  beforeEach(async () => {
    db = new BrewDB('test-backup')
    await db.open()
    backup = makeBackupService(db)
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-backup')
  })

  it('dump() returns an object with all seven tables (v3 schema)', async () => {
    const dump = await backup.dump()
    expect(dump.version).toBe(8)
    expect(dump.tables).toHaveProperty('recipes')
    expect(dump.tables).toHaveProperty('equipmentProfiles')
    expect(dump.tables).toHaveProperty('ingredients')
    expect(dump.tables).toHaveProperty('settings')
    expect(dump.tables).toHaveProperty('inventoryItems')
    expect(dump.tables).toHaveProperty('gearItems')
    expect(dump.tables).toHaveProperty('waterProfiles')
  })

  it('restore() accepts a legacy V1 dump (backwards compatible)', async () => {
    const v1Dump = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      tables: {
        recipes: [],
        equipmentProfiles: [],
        ingredients: [],
        settings: [],
      },
    }
    await expect(backup.restore(v1Dump)).resolves.not.toThrow()
  })

  it('restore() replaces all data atomically', async () => {
    const settingsRepo = makeSettingsRepo(db)
    await settingsRepo.save({
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
      theme: 'matrix',
      schemaVersion: 1,
    })

    const dumpA = await backup.dump()

    await settingsRepo.save({
      id: 'global',
      units: 'imperial',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
      theme: 'cyberpunk',
      schemaVersion: 1,
    })

    await backup.restore(dumpA)
    const restored = await settingsRepo.get()
    expect(restored?.theme).toBe('matrix')
  })

  it('restore() rejects a dump with wrong version', async () => {
    await expect(
      backup.restore({
        version: 999 as 1,
        exportedAt: new Date().toISOString(),
        tables: {} as never,
      }),
    ).rejects.toThrow()
  })

  const gearItem = () => ({
    id: '33333333-3333-4333-8333-333333333333',
    name: 'CO2 Regulator',
    category: 'kegging' as const,
    condition: 'good' as const,
    notes_md: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    schemaVersion: 1 as const,
  })
  const inventoryItem = () => ({
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Maris Otter',
    ingredientKind: 'fermentable' as const,
    amount: 5,
    amountUnit: 'kg' as const,
    status: 'sealed' as const,
    notes_md: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    schemaVersion: 1 as const,
  })

  it('restoring a V1 dump preserves existing gear + inventory (no data loss)', async () => {
    await db.gearItems.put(gearItem())
    await db.inventoryItems.put(inventoryItem())

    await backup.restore({
      version: 1,
      exportedAt: new Date().toISOString(),
      tables: { recipes: [], equipmentProfiles: [], ingredients: [], settings: [] },
    })

    expect(await db.gearItems.count()).toBe(1)
    expect(await db.inventoryItems.count()).toBe(1)
  })

  it('aborts before clearing when a row is invalid (good data survives)', async () => {
    const settingsRepo = makeSettingsRepo(db)
    await settingsRepo.save({
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
      theme: 'matrix',
      schemaVersion: 1,
    })

    const corrupt = {
      version: 2 as const,
      exportedAt: new Date().toISOString(),
      tables: {
        recipes: [{ id: 'not-a-uuid', name: '' }],
        equipmentProfiles: [],
        ingredients: [],
        settings: [],
        inventoryItems: [],
        gearItems: [],
      },
    } as never

    await expect(backup.restore(corrupt)).rejects.toThrow()
    // Pre-existing settings must be untouched — clear() never ran.
    expect((await settingsRepo.get())?.theme).toBe('matrix')
  })
})

const v4Recipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'SMaSH',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440101',
      snapshot: { name: '2-Row', type: 'base', ppg: 37, color_L: 2 },
      amount_kg: 4.5,
      usage: 'mash',
      afterBoil: false,
    },
  ],
  hops: [],
  yeasts: [],
  miscs: [],
  mashSteps: [{ name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 }],
  notes_md: '',
  createdAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
}
const v4Batch = (): Batch => ({
  id: '55555555-5555-4555-8555-555555555555',
  batchNo: 1,
  name: 'SMaSH #1',
  status: 'complete',
  recipeSnapshot: v4Recipe,
  equipmentSnapshot: B40PRO_PROFILE,
  computedTargets: calculateRecipe(v4Recipe, B40PRO_PROFILE, '2026-06-25T12:00:00.000Z'),
  process: [],
  logs: [],
  timers: [],
  results: { measuredOG: 1.048, measuredFG: 1.012 },
  startedAt: '2026-06-25T12:00:00.000Z',
  updatedAt: '2026-06-25T12:00:00.000Z',
  schemaVersion: 1,
})

describe('backup v4 (batches/sessions/timers)', () => {
  let db: BrewDB
  let backup: ReturnType<typeof makeBackupService>
  beforeEach(async () => {
    db = new BrewDB('test-backup-v4')
    await db.open()
    backup = makeBackupService(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-backup-v4')
  })

  it('dump() is version 6 and includes the batches table', async () => {
    const dump = await backup.dump()
    expect(dump.version).toBe(8)
    expect(dump.tables).toHaveProperty('batches')
    expect(dump.tables).toHaveProperty('brewSessions')
    expect(dump.tables).toHaveProperty('brewTimers')
  })

  it('dump → restore round-trips batches with equality', async () => {
    const repo = makeBatchRepo(db)
    await repo.save(v4Batch())
    const dumpA = await backup.dump()
    await repo.delete('55555555-5555-4555-8555-555555555555')
    expect(await repo.get('55555555-5555-4555-8555-555555555555')).toBeNull()
    await backup.restore(dumpA)
    const restored = await repo.get('55555555-5555-4555-8555-555555555555')
    expect(restored?.batchNo).toBe(1)
    expect(restored?.results.measuredOG).toBe(1.048)
  })

  it('restoring a V3 dump leaves the batches table untouched (no wipe)', async () => {
    const repo = makeBatchRepo(db)
    await repo.save(v4Batch())
    await backup.restore({
      version: 3,
      exportedAt: new Date().toISOString(),
      tables: {
        recipes: [],
        equipmentProfiles: [],
        ingredients: [],
        settings: [],
        inventoryItems: [],
        gearItems: [],
        waterProfiles: [],
      },
    })
    expect(await db.batches.count()).toBe(1)
  })

  it('restore() writes inventory & gear rows from a v4 dump (hasPhase2 gate)', async () => {
    // Seed a stale inventory row that must be removed by the restore.
    const staleGear = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Stale Gear',
      category: 'kegging' as const,
      condition: 'good' as const,
      notes_md: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1 as const,
    }
    await db.gearItems.put(staleGear)
    expect(await db.gearItems.count()).toBe(1)

    // Build a v4 dump that contains one inventory item and one gear item
    // (different IDs from the stale row — proves clear-then-write semantics).
    const dumpGear = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Conical Fermenter',
      category: 'fermenter' as const,
      condition: 'good' as const,
      notes_md: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1 as const,
    }
    const dumpInventory = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'Maris Otter',
      ingredientKind: 'fermentable' as const,
      amount: 10,
      amountUnit: 'kg' as const,
      status: 'sealed' as const,
      notes_md: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1 as const,
    }

    const v4Dump = await backup.dump() // get a real v4 skeleton
    // Inject our rows directly into the dump structure.
    const dump = {
      ...v4Dump,
      tables: {
        ...v4Dump.tables,
        inventoryItems: [dumpInventory],
        gearItems: [dumpGear],
      },
    }

    await backup.restore(dump)

    // Stale gear (aaaa…) must be gone — restore clears then writes.
    expect(await db.gearItems.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBeUndefined()
    // Dump gear (bbbb…) must be present.
    expect(await db.gearItems.count()).toBe(1)
    const restoredGear = await db.gearItems.get('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(restoredGear?.name).toBe('Conical Fermenter')
    // Inventory row (cccc…) must be present.
    expect(await db.inventoryItems.count()).toBe(1)
    const restoredInv = await db.inventoryItems.get('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    expect(restoredInv?.name).toBe('Maris Otter')
    expect(restoredInv?.amount).toBe(10)
  })
})

describe('backup v5 (fermentation readings)', () => {
  let db: BrewDB
  let backup: ReturnType<typeof makeBackupService>
  beforeEach(async () => {
    db = new BrewDB('test-backup-v5')
    await db.open()
    backup = makeBackupService(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-backup-v5')
  })

  const reading = () => ({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    batchId: '55555555-5555-4555-8555-555555555555',
    at: '2026-07-04T12:00:00.000Z',
    gravity: 1.032,
    tempC: 19.5,
    ph: 4.4,
    note: 'krausen forming',
    schemaVersion: 1 as const,
  })

  it('dump() is version 6 and includes the readings table', async () => {
    const dump = await backup.dump()
    expect(dump.version).toBe(8)
    expect(dump.tables).toHaveProperty('readings')
  })

  it('dump → restore round-trips readings with equality', async () => {
    await db.readings.put(reading())
    const dumpA = await backup.dump()
    await db.readings.clear()
    expect(await db.readings.count()).toBe(0)
    await backup.restore(dumpA)
    const restored = await db.readings.get('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    expect(restored?.gravity).toBe(1.032)
    expect(restored?.tempC).toBe(19.5)
    expect(restored?.note).toBe('krausen forming')
  })

  it('wipe() clears the readings table', async () => {
    await db.readings.put(reading())
    expect(await db.readings.count()).toBe(1)
    await backup.wipe()
    expect(await db.readings.count()).toBe(0)
  })

  it('restoring a V4 dump leaves the readings table untouched (no wipe)', async () => {
    await db.readings.put(reading())
    await backup.restore({
      version: 4,
      exportedAt: new Date().toISOString(),
      tables: {
        recipes: [],
        equipmentProfiles: [],
        ingredients: [],
        settings: [],
        inventoryItems: [],
        gearItems: [],
        waterProfiles: [],
        batches: [],
        brewSessions: [],
        brewTimers: [],
      },
    })
    expect(await db.readings.count()).toBe(1)
  })
})

describe('backup v6 (stock ledger)', () => {
  let db: BrewDB
  let backup: ReturnType<typeof makeBackupService>
  beforeEach(async () => {
    db = new BrewDB('test-backup-v6')
    await db.open()
    backup = makeBackupService(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-backup-v6')
  })

  const stockTxn = () => ({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    inventoryItemId: '44444444-4444-4444-8444-444444444444',
    kind: 'fermentable' as const,
    delta: 5,
    unit: 'kg' as const,
    reason: 'opening' as const,
    at: '2026-07-05T00:00:00.000Z',
    schemaVersion: 1 as const,
  })

  it('dump() is version 6 and includes the stockTransactions table', async () => {
    const dump = await backup.dump()
    expect(dump.version).toBe(8)
    expect(dump.tables).toHaveProperty('stockTransactions')
  })

  it('dump → restore round-trips stockTransactions with equality', async () => {
    await db.stockTransactions.put(stockTxn())
    const dumpA = await backup.dump()
    await db.stockTransactions.clear()
    expect(await db.stockTransactions.count()).toBe(0)
    await backup.restore(dumpA)
    const restored = await db.stockTransactions.get('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    expect(restored?.delta).toBe(5)
    expect(restored?.reason).toBe('opening')
    expect(restored?.unit).toBe('kg')
  })

  it('wipe() clears the stockTransactions table', async () => {
    await db.stockTransactions.put(stockTxn())
    expect(await db.stockTransactions.count()).toBe(1)
    await backup.wipe()
    expect(await db.stockTransactions.count()).toBe(0)
  })

  it('restoring a pre-ledger V5 dump still succeeds and resets the ledger to empty', async () => {
    // A live ledger row that a full restore must replace (restore = replace ALL data).
    await db.stockTransactions.put(stockTxn())
    await backup.restore({
      version: 5,
      exportedAt: new Date().toISOString(),
      tables: {
        recipes: [],
        equipmentProfiles: [],
        ingredients: [],
        settings: [],
        inventoryItems: [],
        gearItems: [],
        waterProfiles: [],
        batches: [],
        brewSessions: [],
        brewTimers: [],
        readings: [],
      },
    })
    // No ledger in a v5 dump → the table ends up empty (no stale/orphan rows).
    expect(await db.stockTransactions.count()).toBe(0)
  })

  it('rejects a v6 dump whose stockTransactions row is invalid (aborts before clear)', async () => {
    await db.stockTransactions.put(stockTxn())
    const good = await backup.dump()
    const corrupt = {
      ...good,
      tables: {
        ...good.tables,
        stockTransactions: [{ id: 'not-a-uuid', delta: 1 }],
      },
    } as never
    await expect(backup.restore(corrupt)).rejects.toThrow()
    // Pre-existing ledger row untouched — validation failed before any clear().
    expect(await db.stockTransactions.count()).toBe(1)
  })
})
