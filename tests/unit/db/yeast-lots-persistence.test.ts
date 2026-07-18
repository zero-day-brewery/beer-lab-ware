import { afterEach, describe, expect, it } from 'vitest'

import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { type DumpV8, makeBackupService } from '@/lib/db/backup'
import { makeYeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { BrewDB } from '@/lib/db/schema'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`yeast-test-${Date.now()}-${n++}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})

function lot(over: Partial<YeastLot> = {}): YeastLot {
  return {
    id: crypto.randomUUID(),
    name: 'WLP001 California Ale',
    strain: 'California Ale',
    form: 'liquid',
    productionDate: '2026-05-01T00:00:00.000Z',
    initialCells_B: 100,
    generation: 0,
    quantity: 2,
    unit: 'vial',
    notes_md: '',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

describe('yeastLotsRepo', () => {
  it('round-trips a lot through save → get → list', async () => {
    const repo = makeYeastLotsRepo(freshDb())
    const l = lot()
    await repo.save(l)
    const got = await repo.get(l.id)
    expect(got?.strain).toBe('California Ale')
    expect((await repo.list()).length).toBe(1)
  })

  it('listByStrain matches case-insensitively', async () => {
    const repo = makeYeastLotsRepo(freshDb())
    await repo.save(lot({ strain: 'California Ale' }))
    await repo.save(lot({ strain: 'Hefeweizen' }))
    expect((await repo.listByStrain('  california ale ')).length).toBe(1)
  })

  it('consume decrements quantity and clamps at 0', async () => {
    const repo = makeYeastLotsRepo(freshDb())
    const l = lot({ quantity: 2 })
    await repo.save(l)
    expect((await repo.consume(l.id, 1))?.quantity).toBe(1)
    expect((await repo.consume(l.id, 5))?.quantity).toBe(0) // clamped
  })
})

describe('backup dump/restore — yeast lots', () => {
  it('dump includes yeastLots and a same-version restore round-trips them', async () => {
    const src = freshDb()
    await makeYeastLotsRepo(src).save(lot({ strain: 'Saison' }))
    const dumped = await makeBackupService(src).dump()
    expect(dumped.version).toBe(10) // DUMP_VERSION — see dump-v9.test.ts for the envelope-bump coverage
    expect(dumped.tables.yeastLots.length).toBe(1)

    const dst = freshDb()
    await makeBackupService(dst).restore(dumped)
    expect((await dst.yeastLots.toArray()).length).toBe(1)
  })

  it('restoring an older v7 dump leaves existing yeast lots untouched', async () => {
    const target = freshDb()
    await makeYeastLotsRepo(target).save(lot({ strain: 'Kept' }))
    // a v7 dump has no yeastLots table
    const v7: Parameters<ReturnType<typeof makeBackupService>['restore']>[0] = {
      version: 7,
      exportedAt: '2026-06-01T00:00:00.000Z',
      meta: { dumpVersion: 7, dbVersion: 8, schemaVersion: 1, rowCounts: {} },
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
        seedTombstones: [],
      },
    } as unknown as DumpV8
    await makeBackupService(target).restore(v7)
    const kept = await target.yeastLots.toArray()
    expect(kept.length).toBe(1) // untouched — NULL pattern
    expect(kept[0].strain).toBe('Kept')
  })
})
