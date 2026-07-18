import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WATER_PROFILES } from '@/lib/brewing/defaults/water-profiles'
import { WaterSchema } from '@/lib/brewing/types/ingredient'
import { backupService } from '@/lib/db/backup'
import { waterRepo } from '@/lib/db/repos/water'
import { db } from '@/lib/db/schema'
import { seedDefaults } from '@/lib/db/seed'

describe('water profiles data layer', () => {
  beforeEach(async () => {
    await db.waterProfiles.clear()
    await db.seedTombstones.clear()
  })
  afterEach(async () => {
    await db.waterProfiles.clear()
  })

  it('every seeded profile is a valid Water row', () => {
    for (const p of WATER_PROFILES) expect(() => WaterSchema.parse(p)).not.toThrow()
  })
  it('seeds the source profiles idempotently', async () => {
    const a = await seedDefaults(db)
    expect(a.insertedWater).toBe(WATER_PROFILES.length)
    const b = await seedDefaults(db)
    expect(b.insertedWater).toBe(0)
    expect((await waterRepo.list()).length).toBe(WATER_PROFILES.length)
  })
  it('a v3 backup round-trips waterProfiles', async () => {
    await seedDefaults(db)
    const dump = await backupService.dump()
    expect(dump.version).toBe(10)
    await db.waterProfiles.clear()
    await backupService.restore(dump)
    expect((await waterRepo.list()).length).toBe(WATER_PROFILES.length)
  })
})
