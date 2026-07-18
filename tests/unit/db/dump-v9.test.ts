/**
 * DumpV9 envelope: adds `rowTombstones` (deletion tombstones for the sync
 * merge — see sync/merge.ts + db/repos/*.ts). Covers: dump()/restore()
 * round-trip, forward migration of an older (pre-v9) dump (empty tombstone
 * set, existing local tombstones untouched EXCEPT for the ids this restore
 * itself recreates), and the "restore clears tombstones for rows it
 * re-creates" rule required so a restored row survives the next sync merge.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { type DumpV9, makeBackupService } from '@/lib/db/backup'
import { makeRecipeRepo } from '@/lib/db/repos/recipe'
import { BrewDB } from '@/lib/db/schema'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`dump-v9-${Date.now()}-${n++}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})

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

describe('backup dump/restore — DumpV9 rowTombstones', () => {
  it('dump() carries rowTombstones forward (introduced in v9, unchanged in the current envelope)', async () => {
    const db = freshDb()
    const id = crypto.randomUUID()
    await db.recipes.put(recipe({ id }))
    await makeRecipeRepo(db).delete(id)

    const dumped = await makeBackupService(db).dump()
    expect(dumped.version).toBe(10)
    expect(dumped.tables.rowTombstones).toHaveLength(1)
    expect(dumped.tables.rowTombstones[0]).toMatchObject({ id, table: 'recipes' })
  })

  it('a v9 restore round-trips rowTombstones', async () => {
    const src = freshDb()
    const id = crypto.randomUUID()
    await src.recipes.put(recipe({ id }))
    await makeRecipeRepo(src).delete(id)
    const dumped = await makeBackupService(src).dump()

    const dst = freshDb()
    await makeBackupService(dst).restore(dumped)
    expect(await dst.rowTombstones.toArray()).toEqual(dumped.tables.rowTombstones)
  })

  it('restoring an older v8 dump (no rowTombstones table) imports cleanly with an empty tombstone set added, existing tombstones untouched', async () => {
    const target = freshDb()
    const preexistingId = crypto.randomUUID()
    await target.rowTombstones.put({
      id: preexistingId,
      table: 'recipes',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    const v8 = {
      version: 8,
      exportedAt: '2026-06-01T00:00:00.000Z',
      meta: { dumpVersion: 8, dbVersion: 9, schemaVersion: 1, rowCounts: {} },
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
        yeastLots: [],
      },
    } as unknown as DumpV9
    await expect(makeBackupService(target).restore(v8)).resolves.toBeUndefined()
    // pre-existing tombstone (for a row this v8 dump never touched) survives untouched
    const kept = await target.rowTombstones.get(preexistingId)
    expect(kept).toEqual({
      id: preexistingId,
      table: 'recipes',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('restore clears the tombstone for any row id it re-creates (a v9 dump self-contradicting itself)', async () => {
    const target = freshDb()
    const id = crypto.randomUUID()
    await target.rowTombstones.put({ id, table: 'recipes', deletedAt: '2026-01-01T00:00:00.000Z' })

    const dump: DumpV9 = {
      version: 9,
      exportedAt: '2026-06-01T00:00:00.000Z',
      meta: { dumpVersion: 9, dbVersion: 9, schemaVersion: 1, rowCounts: {} },
      tables: {
        recipes: [recipe({ id })], // the dump recreates the SAME id
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
        yeastLots: [],
        rowTombstones: [], // the dump itself carries no tombstone for id — still must be cleared
      },
    }
    await makeBackupService(target).restore(dump)
    expect(await target.recipes.get(id)).toBeDefined()
    expect(await target.rowTombstones.get(id)).toBeUndefined()
  })

  it('restoring a PRE-v9 dump that recreates a tombstoned id clears that specific tombstone (survives the next sync merge)', async () => {
    const target = freshDb()
    const id = crypto.randomUUID()
    await target.rowTombstones.put({ id, table: 'recipes', deletedAt: '2026-01-01T00:00:00.000Z' })

    const v7 = {
      version: 7,
      exportedAt: '2026-06-01T00:00:00.000Z',
      meta: { dumpVersion: 7, dbVersion: 9, schemaVersion: 1, rowCounts: {} },
      tables: {
        recipes: [recipe({ id })],
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
    } as unknown as DumpV9
    await makeBackupService(target).restore(v7)
    expect(await target.recipes.get(id)).toBeDefined()
    expect(await target.rowTombstones.get(id)).toBeUndefined() // cleared even though v7 has no rowTombstones table at all
  })

  it('wipe() clears rowTombstones too', async () => {
    const db = freshDb()
    await db.rowTombstones.put({ id: 'x', table: 'recipes', deletedAt: '2026-01-01T00:00:00.000Z' })
    await makeBackupService(db).wipe()
    expect(await db.rowTombstones.count()).toBe(0)
  })

  // Adversarial-review hardening: a corrupt `deletedAt` must be REJECTED at
  // the Zod boundary (parse-on-read), not silently accepted as a value that
  // later fails open (Date.parse → NaN → never suppresses, never GCs — see
  // sync/merge.ts + sync-client.ts's GC pass).
  it('restore() rejects a rowTombstone whose deletedAt does not parse to a finite timestamp', async () => {
    const target = freshDb()
    const bad = {
      version: 9,
      exportedAt: '2026-06-01T00:00:00.000Z',
      meta: { dumpVersion: 9, dbVersion: 11, schemaVersion: 1, rowCounts: {} },
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
        yeastLots: [],
        rowTombstones: [{ id: 'x', table: 'recipes', deletedAt: 'not-a-date' }],
      },
    } as unknown as DumpV9
    await expect(makeBackupService(target).restore(bad)).rejects.toThrow()
    expect(await target.rowTombstones.count()).toBe(0) // rejected BEFORE any clear()
  })
})
