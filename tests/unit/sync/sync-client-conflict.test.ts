/**
 * syncOnce — push-side optimistic-concurrency retry loop.
 *
 * The DEFECT this closes: two devices both pull state S0, both merge locally,
 * then both push — without a precondition, the second push silently replaces
 * the first (S1b clobbers S1a) and the first device's changes vanish from
 * canonical until it happens to sync again. With ETag/If-Match wired through
 * `SyncTransport`, a stale push is rejected (412) instead of silently
 * accepted, and `syncOnce` recovers by re-pulling, re-merging (the full merge
 * machinery — including `sync-reconcile` — runs again), and retrying the push
 * with the fresh etag, bounded to a small number of attempts before surfacing
 * a typed failure.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { makeBackupService } from '@/lib/db/backup'
import { makeYeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { BrewDB } from '@/lib/db/schema'
import { SyncPushConflictError, syncOnce } from '@/lib/sync/sync-client'
import type {
  SyncPayload,
  SyncPullResult,
  SyncPushResult,
  SyncTransport,
} from '@/lib/sync/transport'
import { InMemorySyncTransport } from '@/lib/sync/transport'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`sync-conflict-${Date.now()}-${n++}`)
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

describe('syncOnce — retries a 412 push (competing writer between pull and push)', () => {
  it('re-pulls, re-merges, and retries; final canonical contains BOTH writers data', async () => {
    const shared = new InMemorySyncTransport()
    const dbA = freshDb()
    const idA = crypto.randomUUID()
    const idB = crypto.randomUUID()
    await makeYeastLotsRepo(dbA).save(lot({ id: idA, strain: 'A-Strain' }))

    // Wraps the shared transport: the FIRST time device A's syncOnce calls
    // pull(), a competing device B lands a full syncOnce (its own pull → merge
    // → push) BEFORE returning control to A — simulating a writer racing in
    // between A's pull and A's push. Subsequent pulls (A's retry) pass through
    // untouched, so the race only fires once.
    let pullCount = 0
    const racyTransport: SyncTransport = {
      pull: async (): Promise<SyncPullResult> => {
        const result = await shared.pull()
        pullCount += 1
        if (pullCount === 1) {
          const dbB = freshDb()
          await makeYeastLotsRepo(dbB).save(lot({ id: idB, strain: 'B-Strain' }))
          await syncOnce({
            transport: shared,
            backup: makeBackupService(dbB),
            snapshot: noopSnapshot,
            now: '2026-06-01T00:00:30.000Z',
          })
        }
        return result
      },
      push: (payload: SyncPayload, ifMatch?: string | null): Promise<SyncPushResult> =>
        shared.push(payload, ifMatch),
    }

    const result = await syncOnce({
      transport: racyTransport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })

    expect(result.pushed).toBe(true)
    expect(pullCount).toBeGreaterThanOrEqual(2) // the initial pull + at least one retry pull

    // Canonical (via the shared transport, independent of either device's local
    // DB) converged to contain BOTH writers' data — the lost-update is closed.
    const finalPull = await shared.pull()
    const strains = (finalPull.payload?.tables.yeastLots ?? []).map((l) => l.strain).sort()
    expect(strains).toEqual(['A-Strain', 'B-Strain'])

    // Device A's own local DB also has the union (its own retry restored it).
    const aStrains = (await makeYeastLotsRepo(dbA).list()).map((l) => l.strain).sort()
    expect(aStrains).toEqual(['A-Strain', 'B-Strain'])
  })
})

describe('syncOnce — bounded retry exhaustion', () => {
  it('surfaces a typed SyncPushConflictError after exhausting retries against a persistently stale precondition', async () => {
    const dbA = freshDb()
    await makeYeastLotsRepo(dbA).save(lot({ id: crypto.randomUUID(), strain: 'A-Strain' }))

    let pushAttempts = 0
    const stubbornTransport: SyncTransport = {
      pull: async (): Promise<SyncPullResult> => ({ payload: null, etag: null }),
      push: async (): Promise<SyncPushResult> => {
        pushAttempts += 1
        return { ok: false, status: 412, currentEtag: '"always-stale"' }
      },
    }

    const failure = await syncOnce({
      transport: stubbornTransport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    }).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(SyncPushConflictError)
    const err = failure as SyncPushConflictError
    expect(err.attempts).toBe(3)
    expect(err.lastStatus).toBe(412)
    expect(err.currentEtag).toBe('"always-stale"')
    expect(pushAttempts).toBe(3) // exactly 3 total push attempts, not unbounded
  })

  it('does not retry a 428 (no precondition) — surfaces the typed failure on the first attempt', async () => {
    const dbA = freshDb()
    await makeYeastLotsRepo(dbA).save(lot({ id: crypto.randomUUID(), strain: 'A-Strain' }))

    let pushAttempts = 0
    const brokenTransport: SyncTransport = {
      pull: async (): Promise<SyncPullResult> => ({ payload: null, etag: null }),
      push: async (): Promise<SyncPushResult> => {
        pushAttempts += 1
        return { ok: false, status: 428 }
      },
    }

    const failure = await syncOnce({
      transport: brokenTransport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    }).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(SyncPushConflictError)
    expect((failure as SyncPushConflictError).lastStatus).toBe(428)
    expect(pushAttempts).toBe(1)
  })
})
