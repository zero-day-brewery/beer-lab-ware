import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Reading } from '@/lib/brewing/types/reading'
import { makeReadingsRepo } from '@/lib/db/repos/readings'
import { BrewDB } from '@/lib/db/schema'

const BATCH = '11111111-1111-4111-8111-111111111111'

function reading(id: string, at: string, over: Partial<Reading> = {}): Reading {
  return {
    id,
    batchId: BATCH,
    at,
    gravity: 1.04,
    tempC: 20,
    schemaVersion: 1,
    ...over,
  }
}

describe('readingsRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeReadingsRepo>

  beforeEach(async () => {
    db = new BrewDB('test-readings')
    await db.open()
    repo = makeReadingsRepo(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-readings')
  })

  it('create() validates + persists, listByBatch() round-trips through Zod', async () => {
    await repo.create(reading('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-07-04T12:00:00.000Z'))
    const rows = await repo.listByBatch(BATCH)
    expect(rows).toHaveLength(1)
    expect(rows[0].gravity).toBe(1.04)
    expect(rows[0].tempC).toBe(20)
    expect(rows[0].schemaVersion).toBe(1)
  })

  it('listByBatch() returns readings sorted ascending by time', async () => {
    await repo.create(reading('33333333-3333-4333-8333-333333333333', '2026-07-06T12:00:00.000Z'))
    await repo.create(reading('11111111-2222-4222-8222-222222222222', '2026-07-04T12:00:00.000Z'))
    await repo.create(reading('22222222-2222-4222-8222-222222222222', '2026-07-05T12:00:00.000Z'))
    const rows = await repo.listByBatch(BATCH)
    expect(rows.map((r) => r.at)).toEqual([
      '2026-07-04T12:00:00.000Z',
      '2026-07-05T12:00:00.000Z',
      '2026-07-06T12:00:00.000Z',
    ])
  })

  it('listByBatch() scopes to a single batch', async () => {
    await repo.create(reading('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-07-04T12:00:00.000Z'))
    await repo.create(
      reading('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-07-04T12:00:00.000Z', {
        batchId: 'other-batch',
      }),
    )
    expect(await repo.listByBatch(BATCH)).toHaveLength(1)
    expect(await repo.listByBatch('other-batch')).toHaveLength(1)
  })

  it('delete() removes a single reading', async () => {
    await repo.create(reading('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-07-04T12:00:00.000Z'))
    await repo.create(reading('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-07-05T12:00:00.000Z'))
    await repo.delete('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const rows = await repo.listByBatch(BATCH)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('create() rejects a row that fails Zod validation (bad id)', async () => {
    await expect(
      repo.create({
        id: 'not-a-uuid',
        batchId: BATCH,
        at: '2026-07-04T12:00:00.000Z',
        schemaVersion: 1,
      } as Reading),
    ).rejects.toThrow()
    expect(await db.readings.count()).toBe(0)
  })

  it('accepts optional-only readings (note without measurements)', async () => {
    await repo.create({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      batchId: BATCH,
      at: '2026-07-04T12:00:00.000Z',
      note: 'pitched US-05',
      schemaVersion: 1,
    })
    const rows = await repo.listByBatch(BATCH)
    expect(rows[0].note).toBe('pitched US-05')
    expect(rows[0].gravity).toBeUndefined()
  })
})
