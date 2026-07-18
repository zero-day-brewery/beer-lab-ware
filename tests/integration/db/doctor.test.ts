import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { B40PRO_PROFILE_ID } from '@/lib/brewing/defaults/b40pro'
import { InventoryItemSchema } from '@/lib/brewing/types/inventory'
import { autoFixLedger, runDataDoctor } from '@/lib/db/doctor'
import { BrewDB } from '@/lib/db/schema'
import { seedDefaults } from '@/lib/db/seed'

function uuid() {
  return crypto.randomUUID()
}
function invItem(id: string, amount: number) {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Pale Malt',
    ingredientKind: 'fermentable' as const,
    amount,
    amountUnit: 'kg' as const,
    status: 'sealed' as const,
    notes_md: '',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1 as const,
  }
}
function txn(itemId: string, delta: number) {
  return {
    id: uuid(),
    inventoryItemId: itemId,
    kind: 'fermentable' as const,
    delta,
    unit: 'kg' as const,
    reason: 'opening' as const,
    at: new Date().toISOString(),
    schemaVersion: 1 as const,
  }
}
function settingsRow(defaultEquipmentProfileId: string) {
  return {
    id: 'global' as const,
    units: 'imperial' as const,
    defaultEquipmentProfileId,
    theme: 'default' as const,
    schemaVersion: 1 as const,
  }
}

describe('runDataDoctor', () => {
  let db: BrewDB
  beforeEach(async () => {
    db = new BrewDB('test-doctor')
    await db.open()
    // seedDefaults seeds a valid B40pro equipmentProfile (+ gear/water) we can
    // reference, plus pantry inventoryItems each now paired with a matching
    // `opening` stockTransaction (see seed.ts's saveItemWithTxn rider fix —
    // C1 stays green on a fresh seed, covered by the dedicated describe block
    // below), but writes NO settings row (verified against seed.ts +
    // defaults/pantry.ts), which leaves C5 with no row to check. Normalize to
    // a controlled baseline regardless: clear the seeded inventory + ledger so
    // each test owns its own state, and add a real settings row that
    // references the seeded default equipment profile.
    await seedDefaults(db)
    await db.inventoryItems.clear()
    await db.stockTransactions.clear()
    await db.settings.put(settingsRow(B40PRO_PROFILE_ID))
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-doctor')
  })

  it('reports zero failures for a healthy DB', async () => {
    const id = uuid()
    await db.inventoryItems.add(invItem(id, 5))
    await db.stockTransactions.add(txn(id, 5))
    const report = await runDataDoctor(db, db.verno)
    expect(report.failed).toBe(0)
  })

  it('C1 flags a drifted ledger with epsilon (not ===)', async () => {
    const id = uuid()
    await db.inventoryItems.add(invItem(id, 4.9)) // cached amount drifted from Σ delta (5)
    await db.stockTransactions.add(txn(id, 5))
    const report = await runDataDoctor(db, db.verno)
    const c1 = report.checks.find((c) => c.id === 'C1')
    expect(c1?.ok).toBe(false)
    expect(c1?.canAutoFix).toBe(true)
  })

  it('autoFixLedger recomputes amount = Σ deltas and appends NO stockTransaction', async () => {
    const id = uuid()
    await db.inventoryItems.add(invItem(id, 4.9))
    await db.stockTransactions.add(txn(id, 5))
    const before = await db.stockTransactions.count()
    const fixed = await autoFixLedger(db)
    expect(fixed).toBe(1)
    expect(await db.stockTransactions.count()).toBe(before) // no phantom txn
    expect((await db.inventoryItems.get(id))?.amount).toBe(5)
    const report = await runDataDoctor(db, db.verno)
    expect(report.checks.find((c) => c.id === 'C1')?.ok).toBe(true)
  })

  it('autoFixLedger SKIPS an item whose Σ deltas is negative (never persists an unloadable amount)', async () => {
    // The exact C1 corruption the doctor repairs: a surviving brew-deduct of -5
    // whose matching `opening` row was dropped (partial import / orphan cleanup)
    // leaves Σ deltas negative. Writing that as amount would violate
    // InventoryItemSchema.amount.nonnegative() → a C7 (unloadable) row that blanks
    // the inventory page. The repair must leave such an item untouched.
    const id = uuid()
    await db.inventoryItems.add(invItem(id, 0)) // prior amount 0 (nonneg, loadable)
    await db.stockTransactions.add({ ...txn(id, -5), reason: 'brew-deduct' as const })

    // C1 flags it as drifted (cached 0 !== Σ deltas -5)
    const before = await runDataDoctor(db, db.verno)
    expect(before.checks.find((c) => c.id === 'C1')?.ok).toBe(false)

    const fixed = await autoFixLedger(db)
    // (a) excluded from the fixed count and left at its prior (loadable) amount
    expect(fixed).toBe(0)
    expect((await db.inventoryItems.get(id))?.amount).toBe(0)

    // (b) every stored inventoryItem row still parses — nothing was made unloadable
    for (const row of await db.inventoryItems.toArray()) {
      expect(InventoryItemSchema.safeParse(row).success).toBe(true)
    }

    // still surfaced as un-auto-fixable: C1 keeps reporting the drift
    const after = await runDataDoctor(db, db.verno)
    expect(after.checks.find((c) => c.id === 'C1')?.ok).toBe(false)
  })

  it('C2 flags an orphan stockTransaction', async () => {
    await db.stockTransactions.add(txn(uuid(), 3)) // inventoryItemId points at nothing
    const report = await runDataDoctor(db, db.verno)
    expect(report.checks.find((c) => c.id === 'C2')?.ok).toBe(false)
  })

  it('C3 flags an orphan reading.batchId', async () => {
    await db.readings.add({
      id: uuid(),
      batchId: 'ghost-batch',
      at: new Date().toISOString(),
      schemaVersion: 1,
    })
    const report = await runDataDoctor(db, db.verno)
    expect(report.checks.find((c) => c.id === 'C3')?.ok).toBe(false)
  })

  it('C4 flags an orphan brewTimer.sessionId', async () => {
    await db.brewTimers.add({
      id: 't1',
      sessionId: uuid(),
      stepId: 's1',
      label: 'Mash',
      durationMin: 60,
      fireAt: new Date().toISOString(),
      status: 'armed',
      isBoilMaster: false,
    })
    const report = await runDataDoctor(db, db.verno)
    expect(report.checks.find((c) => c.id === 'C4')?.ok).toBe(false)
  })

  it('C5 flags a dangling settings.defaultEquipmentProfileId', async () => {
    // put (not update): overwrite the beforeEach global row so it references a
    // profile id that does not exist. update('global', …) would also work now that
    // beforeEach seeds the row, but put is unambiguous and never a silent no-op.
    await db.settings.put(settingsRow(uuid()))
    const report = await runDataDoctor(db, db.verno)
    expect(report.checks.find((c) => c.id === 'C5')?.ok).toBe(false)
  })

  it('C6 flags a verno mismatch (expected derived, not hardcoded 8)', async () => {
    const report = await runDataDoctor(db, db.verno + 1)
    expect(report.checks.find((c) => c.id === 'C6')?.ok).toBe(false)
  })

  it('C7 flags a row that fails its Zod schema', async () => {
    await db.recipes.add({ id: 'not-a-recipe' } as unknown as never)
    const report = await runDataDoctor(db, db.verno)
    expect(report.checks.find((c) => c.id === 'C7')?.ok).toBe(false)
  })

  it('C8 passes clean (no anomalies) on a healthy DB with no tombstones', async () => {
    const report = await runDataDoctor(db, db.verno)
    const c8 = report.checks.find((c) => c.id === 'C8')
    expect(c8?.ok).toBe(true)
    expect(c8?.count).toBe(0)
  })

  it('C8 fires on a constructed bad state: a live row OLDER than its own tombstone (should have been suppressed by the sync merge — a merge bug)', async () => {
    const id = uuid()
    await db.recipes.add({
      id,
      name: 'Zombie Ale',
      type: 'all-grain',
      batchSize_L: 19,
      boilTime_min: 60,
      equipmentProfileId: B40PRO_PROFILE_ID,
      fermentables: [],
      hops: [],
      yeasts: [],
      miscs: [],
      mashSteps: [],
      notes_md: '',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z', // OLDER than the tombstone below
      schemaVersion: 1,
    } as never)
    await db.rowTombstones.add({ id, table: 'recipes', deletedAt: '2026-06-01T00:00:00.000Z' })

    const report = await runDataDoctor(db, db.verno)
    const c8 = report.checks.find((c) => c.id === 'C8')
    expect(c8?.ok).toBe(false)
    expect(c8?.severity).toBe('warn')
    expect(c8?.sampleIds).toContain(`recipes:${id}`)
  })

  it('C8 does NOT fire on a legitimate edit-after-delete (row newer than its tombstone — the tombstone is just not yet GC-ed)', async () => {
    const id = uuid()
    await db.recipes.add({
      id,
      name: 'Reborn Ale',
      type: 'all-grain',
      batchSize_L: 19,
      boilTime_min: 60,
      equipmentProfileId: B40PRO_PROFILE_ID,
      fermentables: [],
      hops: [],
      yeasts: [],
      miscs: [],
      mashSteps: [],
      notes_md: '',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z', // NEWER than the tombstone below
      schemaVersion: 1,
    } as never)
    await db.rowTombstones.add({ id, table: 'recipes', deletedAt: '2026-06-01T00:00:00.000Z' })

    const report = await runDataDoctor(db, db.verno)
    const c8 = report.checks.find((c) => c.id === 'C8')
    expect(c8?.ok).toBe(true)
  })

  it('C9 flags an orphan deviceLinks.batchId', async () => {
    await db.deviceLinks.add({
      id: uuid(),
      deviceKey: 'tilt:RED',
      batchId: 'ghost-batch',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    })
    const report = await runDataDoctor(db, db.verno)
    expect(report.checks.find((c) => c.id === 'C9')?.ok).toBe(false)
  })

  it('C9 passes when a deviceLink references a real batch', async () => {
    const batchId = uuid()
    await db.batches.add({
      id: batchId,
      batchNo: 1,
      name: 'Batch 1',
      status: 'in-progress',
      process: [],
      logs: [],
      timers: [],
      results: {},
      startedAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      schemaVersion: 1,
    } as never)
    await db.deviceLinks.add({
      id: uuid(),
      deviceKey: 'tilt:RED',
      batchId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    })
    const report = await runDataDoctor(db, db.verno)
    expect(report.checks.find((c) => c.id === 'C9')?.ok).toBe(true)
  })
})

describe('runDataDoctor + seedDefaults (rider fix: fresh install stays C1-clean)', () => {
  // A SEPARATE db from the `runDataDoctor` block above, deliberately WITHOUT
  // the shared beforeEach's inventoryItems/stockTransactions clear — this is
  // exactly the "fresh install, nothing touched yet" scenario the E4 QA
  // finding was about: seedDefaults() alone must leave C1 green.
  let freshDb: BrewDB
  beforeEach(async () => {
    freshDb = new BrewDB('test-doctor-fresh-seed')
    await freshDb.open()
  })
  afterEach(async () => {
    freshDb.close()
    await BrewDB.delete('test-doctor-fresh-seed')
  })

  it('a freshly-seeded database (no user action) passes C1 — every seeded pantry item has a matching opening ledger row', async () => {
    const seeded = await seedDefaults(freshDb)
    expect(seeded.insertedInventory).toBeGreaterThan(0) // sanity: the pantry rider path actually ran

    const report = await runDataDoctor(freshDb, freshDb.verno)
    const c1 = report.checks.find((c) => c.id === 'C1')
    expect(c1?.ok).toBe(true)
    expect(c1?.count).toBe(0)

    // Every seeded item's amount really is backed by exactly one ledger row.
    const items = await freshDb.inventoryItems.toArray()
    for (const item of items) {
      const txns = await freshDb.stockTransactions
        .where('inventoryItemId')
        .equals(item.id)
        .toArray()
      expect(txns).toHaveLength(1)
      expect(txns[0].reason).toBe('opening')
      expect(txns[0].delta).toBe(item.amount)
    }
  })

  it('re-seeding an already-seeded database stays idempotent and C1-clean (no duplicate opening rows)', async () => {
    await seedDefaults(freshDb)
    const second = await seedDefaults(freshDb)
    expect(second.insertedInventory).toBe(0) // every id already existed — skipped, not re-ledgered

    const report = await runDataDoctor(freshDb, freshDb.verno)
    expect(report.checks.find((c) => c.id === 'C1')?.ok).toBe(true)
  })
})
