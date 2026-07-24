import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { salvageDump } from '@/lib/db/open'
import { BrewDB } from '@/lib/db/schema'

const DB_NAME = 'test-salvage'

/**
 * `salvageDump` is the LAST line of defence: the recovery panel offers "Export
 * what we can" and then "Reset database" (a permanent `Dexie.delete`). If the
 * export comes back empty but structurally valid, the user is told their data
 * was rescued and then deletes it.
 *
 * The failure it must survive is precisely the one where Dexie can't help — the
 * on-disk database does not match the schema THIS build declares (a newer build
 * wrote it, or it's mid-corruption). Salvage therefore must read what is
 * ACTUALLY on disk by name, not iterate the app's declared Dexie tables, and it
 * must not mutate the database it is trying to rescue.
 */
async function seedNewerOnDiskDb(): Promise<void> {
  // A database written by a FUTURE build: a higher version, and a store this
  // build has never heard of. Data is perfectly intact; Dexie just refuses at
  // the declared version. That user's brew log IS recoverable.
  const future = new Dexie(DB_NAME)
  future.version(99).stores({
    batches: 'id, status, batchNo',
    futureStore: 'id',
  })
  await future.open()
  await future.table('batches').bulkPut([{ id: 'b-1', status: 'in-progress', batchNo: 1 }])
  await future.table('futureStore').bulkPut([{ id: 'x-1', note: 'written by a newer build' }])
  future.close()
}

/** Read the on-disk native version WITHOUT going through the app's schema. */
async function onDiskVersion(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onsuccess = () => {
      const v = req.result.version
      req.result.close()
      resolve(v)
    }
    req.onerror = () => reject(req.error)
  })
}

describe('salvageDump', () => {
  afterEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  it('rescues the ACTUAL row content of a store this build does not declare', async () => {
    await seedNewerOnDiskDb()

    const blob = await salvageDump(new BrewDB(DB_NAME))
    const parsed = JSON.parse(await blob.text()) as {
      tables: Record<string, Array<{ id: string; note?: string }>>
    }

    // Iterating the app's own declared tables silently drops everything it
    // doesn't know about — the whole brew log if the on-disk schema is newer.
    expect(parsed.tables.futureStore).toHaveLength(1)
    expect(parsed.tables.futureStore[0].note).toBe('written by a newer build')
    expect(parsed.tables.batches).toHaveLength(1)
    expect(parsed.tables.batches[0].id).toBe('b-1')
  })

  it('reports which stores failed instead of silently emitting []', async () => {
    await seedNewerOnDiskDb()

    const blob = await salvageDump(new BrewDB(DB_NAME))
    const parsed = JSON.parse(await blob.text()) as {
      tables: Record<string, unknown[]>
      salvagedAt: string
      failed: string[]
    }

    // A bare `catch { [] }` makes an unreadable table indistinguishable from a
    // genuinely empty one. The rescue file must carry an explicit failure list.
    expect(Array.isArray(parsed.failed)).toBe(true)
    expect(parsed.failed).toEqual([])
    expect(Number.isNaN(Date.parse(parsed.salvagedAt))).toBe(false)
  })

  it('does not mutate (upgrade) the database it is rescuing', async () => {
    await seedNewerOnDiskDb()
    expect(await onDiskVersion(DB_NAME)).toBe(990) // Dexie stores verno * 10

    await salvageDump(new BrewDB(DB_NAME))

    // The old salvage opened BrewDB (declared v12) against the on-disk DB, which
    // Dexie "extends", bumping the native version — mutating a DB we may still
    // want to recover from a different build. Raw read-only open must not.
    expect(await onDiskVersion(DB_NAME)).toBe(990)
  })
})
