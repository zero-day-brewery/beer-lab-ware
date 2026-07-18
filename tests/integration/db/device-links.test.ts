/**
 * deviceLinksRepo — "this sensor feeds that batch" assignments the sync
 * daemon's `POST /readings` resolves against (see reading-ingest.ts). Covers:
 * list/get/getByDeviceKey round-trip through Zod, `assign()`'s upsert-by-key
 * semantics (add vs reassign never creates a second live link for the same
 * device), `remove()` tombstones in the SAME transaction as the delete (same
 * convention as every other repo — see row-tombstones.test.ts), and Zod
 * rejection of a malformed row.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeDeviceLinksRepo } from '@/lib/db/repos/device-links'
import { BrewDB } from '@/lib/db/schema'

const BATCH_A = '11111111-1111-4111-8111-111111111111'
const BATCH_B = '22222222-2222-4222-8222-222222222222'

describe('deviceLinksRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeDeviceLinksRepo>

  beforeEach(async () => {
    db = new BrewDB('test-device-links')
    await db.open()
    repo = makeDeviceLinksRepo(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-device-links')
  })

  it('assign() creates a new link, validated through Zod, listed + gettable', async () => {
    const link = await repo.assign('tilt:RED', BATCH_A)
    expect(link.deviceKey).toBe('tilt:RED')
    expect(link.batchId).toBe(BATCH_A)
    expect(link.schemaVersion).toBe(1)

    expect(await repo.get(link.id)).toEqual(link)
    expect(await repo.getByDeviceKey('tilt:RED')).toEqual(link)
    expect(await repo.list()).toEqual([link])
  })

  it('assign() trims the deviceKey before storing/looking up', async () => {
    const link = await repo.assign('  tilt:RED  ', BATCH_A)
    expect(link.deviceKey).toBe('tilt:RED')
    expect(await repo.getByDeviceKey('tilt:RED')).toBeDefined()
  })

  it('assign() on an existing deviceKey REASSIGNS in place — same id, same createdAt, new batchId — never a second live link', async () => {
    const first = await repo.assign('tilt:RED', BATCH_A)
    const second = await repo.assign('tilt:RED', BATCH_B)

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.batchId).toBe(BATCH_B)
    expect(second.updatedAt >= first.updatedAt).toBe(true)

    const all = await repo.list()
    expect(all).toHaveLength(1)
    expect(all[0].batchId).toBe(BATCH_B)
  })

  it('list() returns links sorted by deviceKey', async () => {
    await repo.assign('tilt:RED', BATCH_A)
    await repo.assign('ispindel:iSpindel001', BATCH_A)
    await repo.assign('rapt:AA:BB:CC', BATCH_B)
    const keys = (await repo.list()).map((l) => l.deviceKey)
    expect(keys).toEqual(['ispindel:iSpindel001', 'rapt:AA:BB:CC', 'tilt:RED'])
  })

  it('getByDeviceKey() returns undefined for an unlinked device', async () => {
    expect(await repo.getByDeviceKey('tilt:GREEN')).toBeUndefined()
  })

  it('remove() deletes the link AND writes a rowTombstone in the same transaction', async () => {
    const link = await repo.assign('tilt:RED', BATCH_A)
    await repo.remove(link.id)

    expect(await repo.get(link.id)).toBeUndefined()
    expect(await db.deviceLinks.get(link.id)).toBeUndefined()

    const tombstone = await db.rowTombstones.get(link.id)
    expect(tombstone).toBeDefined()
    expect(tombstone?.table).toBe('deviceLinks')
    expect(Number.isNaN(Date.parse(tombstone?.deletedAt ?? ''))).toBe(false)
  })

  it('remove() then assign() the same deviceKey again creates a genuinely new link', async () => {
    const first = await repo.assign('tilt:RED', BATCH_A)
    await repo.remove(first.id)
    const second = await repo.assign('tilt:RED', BATCH_B)
    expect(second.id).not.toBe(first.id)
    expect(await repo.list()).toEqual([second])
  })

  it('list()/get() reject a hand-written row that fails Zod validation (bad batchId type)', async () => {
    await db.deviceLinks.put({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deviceKey: 'tilt:RED',
      batchId: 42 as unknown as string,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      schemaVersion: 1,
    })
    await expect(repo.list()).rejects.toThrow()
    await expect(repo.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toThrow()
  })
})
