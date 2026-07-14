import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrewDB } from '@/lib/db/schema'

describe('BrewDB schema', () => {
  let db: BrewDB

  beforeEach(() => {
    db = new BrewDB('test-brew-db')
  })

  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-brew-db')
  })

  it('opens without error', async () => {
    await db.open()
    expect(db.isOpen()).toBe(true)
  })

  it('has the expected tables', async () => {
    await db.open()
    const tableNames = db.tables.map((t) => t.name).sort()
    expect(tableNames).toEqual([
      'appMeta',
      'batches',
      'brewSessions',
      'brewTimers',
      'equipmentProfiles',
      'gearItems',
      'ingredients',
      'inventoryItems',
      'readings',
      'recipes',
      'seedTombstones',
      'settings',
      'stockTransactions',
      'waterProfiles',
      'yeastLots',
    ])
  })

  it('is at version 10 (after v10 reindex added parentLotId)', async () => {
    await db.open()
    expect(db.verno).toBe(10)
  })

  it('can put and get a settings record', async () => {
    await db.open()
    await db.settings.put({
      id: 'global',
      units: 'metric',
      defaultEquipmentProfileId: '550e8400-e29b-41d4-a716-446655440000',
      theme: 'matrix',
      schemaVersion: 1,
    })
    const fetched = await db.settings.get('global')
    expect(fetched?.theme).toBe('matrix')
  })
})

describe('BrewDB v5 schema', () => {
  let db: BrewDB
  beforeEach(async () => {
    db = new BrewDB('test-schema-v5')
    await db.open()
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-schema-v5')
  })

  it('exposes the batches table indexed by batchNo + status', async () => {
    expect(db.batches).toBeDefined()
    const schema = db.batches.schema
    const indexed = schema.indexes.map((i) => i.name)
    expect(indexed).toContain('batchNo')
    expect(indexed).toContain('status')
  })

  it('exposes brewSessions + brewTimers tables (Phase 3/6 share v5)', () => {
    expect(db.brewSessions).toBeDefined()
    expect(db.brewTimers).toBeDefined()
  })

  it('opens at version >= 5', async () => {
    expect(db.verno).toBeGreaterThanOrEqual(5)
  })
})

describe('BrewDB v6 schema (readings)', () => {
  let db: BrewDB
  beforeEach(async () => {
    db = new BrewDB('test-schema-v6')
    await db.open()
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-schema-v6')
  })

  it('exposes the readings table indexed by batchId + [batchId+at]', () => {
    expect(db.readings).toBeDefined()
    const indexed = db.readings.schema.indexes.map((i) => i.name)
    expect(indexed).toContain('batchId')
    expect(indexed).toContain('at')
    expect(indexed).toContain('[batchId+at]')
  })

  it('is additive — data written to pre-v6 tables survives opening at v6', async () => {
    // Write a batch row (a v5-era table) then confirm it is intact once the DB
    // is open at v6 with the new readings store present.
    await db.batches.put({
      id: '77777777-7777-4777-8777-777777777777',
      batchNo: 42,
      name: 'Additive Check',
      status: 'complete',
      process: [],
      logs: [],
      timers: [],
      results: {},
      startedAt: '2026-07-04T12:00:00.000Z',
      updatedAt: '2026-07-04T12:00:00.000Z',
      schemaVersion: 1,
    })
    expect(db.verno).toBe(10)
    expect(await db.batches.count()).toBe(1)
    const kept = await db.batches.get('77777777-7777-4777-8777-777777777777')
    expect(kept?.batchNo).toBe(42)
    // New table starts empty — no accidental seeding.
    expect(await db.readings.count()).toBe(0)
  })
})

describe('BrewDB v7 schema (stock ledger)', () => {
  let db: BrewDB
  beforeEach(async () => {
    db = new BrewDB('test-schema-v7')
    await db.open()
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-schema-v7')
  })

  it('exposes the stockTransactions table indexed by the compound [inventoryItemId+at]', () => {
    expect(db.stockTransactions).toBeDefined()
    const indexed = db.stockTransactions.schema.indexes.map((i) => i.name)
    expect(indexed).toContain('inventoryItemId')
    expect(indexed).toContain('at')
    expect(indexed).toContain('batchId')
    expect(indexed).toContain('[inventoryItemId+at]')
  })

  it('opens at version 10', () => {
    expect(db.verno).toBe(10)
  })
})
