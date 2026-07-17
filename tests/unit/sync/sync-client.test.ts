import { afterEach, describe, expect, it } from 'vitest'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { makeBackupService } from '@/lib/db/backup'
import { makeYeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { BrewDB } from '@/lib/db/schema'
import { syncOnce } from '@/lib/sync/sync-client'
import { makeSyncMetaRepo } from '@/lib/sync/sync-meta'
import { InMemorySyncTransport } from '@/lib/sync/transport'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`sync-test-${Date.now()}-${n++}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})

const noopSnapshot = async () => {}

function lot(over: Partial<YeastLot> & { id: string }): YeastLot {
  return {
    name: 'WLP001',
    strain: 'California Ale',
    form: 'liquid',
    productionDate: '2026-05-01T00:00:00.000Z',
    initialCells_B: 100,
    generation: 0,
    quantity: 1,
    unit: 'vial',
    notes_md: '',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }
}

describe('syncOnce — two devices converge through one transport', () => {
  it('propagates device A yeast lots to device B and back', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    await makeYeastLotsRepo(dbA).save(lot({ id: crypto.randomUUID(), strain: 'A-Strain' }))
    await makeYeastLotsRepo(dbB).save(lot({ id: crypto.randomUUID(), strain: 'B-Strain' }))

    // A syncs first (no remote yet → just publishes A)
    const rA = await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    expect(rA.pulled).toBe(false)
    expect(rA.pushed).toBe(true)

    // B syncs (pulls A, merges, now has BOTH strains, publishes union)
    const rB = await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })
    expect(rB.merged).toBe(true)
    const bStrains = (await makeYeastLotsRepo(dbB).list()).map((l) => l.strain).sort()
    expect(bStrains).toEqual(['A-Strain', 'B-Strain'])

    // A syncs again (pulls the union → converges)
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:02:00.000Z',
    })
    const aStrains = (await makeYeastLotsRepo(dbA).list()).map((l) => l.strain).sort()
    expect(aStrains).toEqual(['A-Strain', 'B-Strain'])
  })

  it('resolves a same-id edit last-write-wins by updatedAt', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const id = crypto.randomUUID()
    // both have the same lot id; B edited it later. Write both directly via put()
    // so the fixture controls updatedAt (repo.save() would re-stamp it to "now").
    await dbA.yeastLots.put(
      lot({ id, strain: 'California Ale', quantity: 1, updatedAt: '2026-06-01T00:00:00.000Z' }),
    )
    await dbB.yeastLots.put(
      lot({ id, strain: 'California Ale', quantity: 9, updatedAt: '2026-06-05T00:00:00.000Z' }),
    )

    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-02T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-06T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-07T00:00:00.000Z',
    })

    // B's later edit (quantity 9) wins on both
    expect((await makeYeastLotsRepo(dbA).get(id))?.quantity).toBe(9)
  })

  it('preserves ledger events from both sides (append-only union)', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const txA = crypto.randomUUID()
    const txB = crypto.randomUUID()
    await dbA.stockTransactions.put({
      id: txA,
      inventoryItemId: crypto.randomUUID(),
      kind: 'yeast',
      delta: 1,
      unit: 'each',
      reason: 'restock',
      at: '2026-06-01T00:00:00.000Z',
      schemaVersion: 1,
    })
    await dbB.stockTransactions.put({
      id: txB,
      inventoryItemId: crypto.randomUUID(),
      kind: 'hop',
      delta: -5,
      unit: 'g',
      reason: 'brew-deduct',
      at: '2026-06-02T00:00:00.000Z',
      schemaVersion: 1,
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-03T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-03T00:01:00.000Z',
    })
    const ids = (await dbB.stockTransactions.toArray()).map((t) => t.id).sort()
    expect(ids).toEqual([txA, txB].sort())
  })
})

describe('syncMetaRepo', () => {
  it('creates a stable device id and records last-sync time', async () => {
    const repo = makeSyncMetaRepo(freshDb())
    const id1 = await repo.deviceId()
    const id2 = await repo.deviceId()
    expect(id1).toBe(id2) // stable
    expect(await repo.lastSyncAt()).toBeNull()
    await repo.setLastSyncAt('2026-06-01T00:00:00.000Z')
    expect(await repo.lastSyncAt()).toBe('2026-06-01T00:00:00.000Z')
  })
})
