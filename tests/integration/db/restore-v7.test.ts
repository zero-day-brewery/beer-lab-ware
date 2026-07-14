import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeBackupService } from '@/lib/db/backup'
import { BrewDB } from '@/lib/db/schema'

describe('restore v7', () => {
  let db: BrewDB
  let backup: ReturnType<typeof makeBackupService>
  beforeEach(async () => {
    db = new BrewDB('test-restore-v7')
    await db.open()
    backup = makeBackupService(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-restore-v7')
  })

  it('round-trips seedTombstones on a v7 dump', async () => {
    await db.seedTombstones.put({ id: 'seed-1' })
    const dumpA = await backup.dump()
    await db.seedTombstones.clear()
    expect(await db.seedTombstones.count()).toBe(0)
    await backup.restore(dumpA)
    expect(await db.seedTombstones.count()).toBe(1)
    expect((await db.seedTombstones.get('seed-1'))?.id).toBe('seed-1')
  })

  it('restoring a v6 dump leaves seedTombstones untouched (no wipe)', async () => {
    await db.seedTombstones.put({ id: 'seed-1' })
    await backup.restore({
      version: 6,
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
        stockTransactions: [],
      },
    })
    expect(await db.seedTombstones.count()).toBe(1)
  })

  it('rejects a corrupt v7 tombstone row before any clear() (no data loss)', async () => {
    await db.seedTombstones.put({ id: 'seed-1' })
    const good = await backup.dump()
    const corrupt = {
      ...good,
      tables: { ...good.tables, seedTombstones: [{ notId: 123 }] },
    } as never
    await expect(backup.restore(corrupt)).rejects.toThrow()
    expect(await db.seedTombstones.count()).toBe(1)
  })
})
