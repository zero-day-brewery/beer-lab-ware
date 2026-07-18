import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DUMP_VERSION, makeBackupService } from '@/lib/db/backup'
import { BrewDB } from '@/lib/db/schema'

describe('backup v7 (seedTombstones + meta)', () => {
  let db: BrewDB
  let backup: ReturnType<typeof makeBackupService>
  beforeEach(async () => {
    db = new BrewDB('test-backup-v7')
    await db.open()
    backup = makeBackupService(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-backup-v7')
  })

  it('DUMP_VERSION is current', () => {
    expect(DUMP_VERSION).toBe(10)
  })

  it('dump() returns the current version and includes seedTombstones', async () => {
    await db.seedTombstones.put({ id: 'seed-recipe-1' })
    const dump = await backup.dump()
    expect(dump.version).toBe(10)
    expect(dump.tables).toHaveProperty('seedTombstones')
    expect(dump.tables.seedTombstones).toEqual([{ id: 'seed-recipe-1' }])
  })

  it('meta records both version counters and correct rowCounts', async () => {
    await db.seedTombstones.put({ id: 'seed-recipe-1' })
    const dump = await backup.dump()
    expect(dump.meta.dumpVersion).toBe(10)
    expect(dump.meta.dbVersion).toBe(12)
    expect(dump.meta.schemaVersion).toBe(1)
    expect(dump.meta.rowCounts.seedTombstones).toBe(1)
  })

  it('appMeta is NOT part of the dump (guards a future 14th table)', async () => {
    const dump = await backup.dump()
    expect(dump.tables).not.toHaveProperty('appMeta')
    expect(dump.meta.rowCounts).not.toHaveProperty('appMeta')
  })
})
