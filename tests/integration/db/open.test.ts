import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyOpenError, openDb, resetDb, salvageDump } from '@/lib/db/open'
import { BrewDB } from '@/lib/db/schema'

describe('classifyOpenError', () => {
  it('maps DexieError.name to a status', () => {
    expect(classifyOpenError(Object.assign(new Error('x'), { name: 'VersionError' })).status).toBe(
      'version-newer',
    )
    expect(
      classifyOpenError(Object.assign(new Error('x'), { name: 'QuotaExceededError' })).status,
    ).toBe('quota')
    expect(classifyOpenError(Object.assign(new Error('x'), { name: 'NotFoundError' })).status).toBe(
      'corrupt',
    )
    expect(classifyOpenError(Object.assign(new Error('x'), { name: 'WeirdError' })).status).toBe(
      'unknown',
    )
  })
})

describe('openDb', () => {
  let database: BrewDB
  afterEach(async () => {
    database?.close()
    await BrewDB.delete('test-open')
    await BrewDB.delete('test-open-ver')
  })

  it('returns ok + verno for a healthy DB', async () => {
    database = new BrewDB('test-open')
    const r = await openDb(database)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.verno).toBe(11)
  })

  it('returns version-newer when the stored DB is a higher version than the code', async () => {
    const high = new Dexie('test-open-ver')
    high.version(3).stores({ t: 'id' })
    await high.open()
    high.close()
    const low = new Dexie('test-open-ver')
    low.version(2).stores({ t: 'id' })
    const r = await openDb(low as unknown as BrewDB)
    low.close()
    expect(r.status).toBe('version-newer')
  })

  it('returns unknown (not blocked) on a bare timeout with no blocked event', async () => {
    // A slow-but-healthy upgrade on a large dataset times out without ever firing
    // a 'blocked' event. That must route to the generic reload path, NOT the
    // "another tab is blocking — close it" dead-end.
    const hanging = {
      on: () => undefined,
      open: () => new Promise(() => {}),
      close: () => undefined,
      verno: 0,
    }
    const r = await openDb(hanging as unknown as BrewDB, 10)
    expect(r.status).toBe('unknown')
  })

  it('returns blocked only when a genuine blocked event fired before the timeout', async () => {
    let blockedCb: (() => void) | undefined
    const hanging = {
      on: (event: string, cb: () => void) => {
        if (event === 'blocked') blockedCb = cb
      },
      open: () => new Promise(() => {}),
      close: () => undefined,
      verno: 0,
    }
    const p = openDb(hanging as unknown as BrewDB, 10)
    blockedCb?.() // a real IndexedDB 'blocked' event fires (another tab holds the DB)
    const r = await p
    expect(r.status).toBe('blocked')
  })
})

describe('salvageDump / resetDb', () => {
  let database: BrewDB
  beforeEach(async () => {
    database = new BrewDB('test-salvage')
    await database.open()
  })
  afterEach(async () => {
    database.close()
    await BrewDB.delete('test-salvage')
  })

  it('salvageDump reads raw rows (no Zod) into a Blob', async () => {
    await database.recipes.add({ id: 'r1' } as unknown as never)
    const blob = await salvageDump(database)
    const text = await blob.text()
    const parsed = JSON.parse(text) as { tables: { recipes: unknown[] } }
    expect(parsed.tables.recipes).toHaveLength(1)
  })

  it('resetDb closes + deletes the database', async () => {
    await database.recipes.add({ id: 'r1' } as unknown as never)
    await resetDb(database)
    const reopened = new BrewDB('test-salvage')
    await reopened.open()
    expect(await reopened.recipes.count()).toBe(0)
    reopened.close()
  })
})
