/**
 * syncOnce — explicit sync modes (Track B, in-app connection UI).
 *
 *   'two-way'   — existing behavior: pull → merge → snapshot+restore → push.
 *   'pull-only' — pull + merge + snapshot + restore, NEVER push. Also no
 *                 first-push seeding: an empty remote stays empty ("phone
 *                 follows" — this device never publishes).
 *   'push-only' — publish local state as canonical with correct If-Match
 *                 handling (incl. the empty-store bootstrap), NEVER restore or
 *                 merge remote data down ("desktop is canonical").
 *
 * All driven through InMemorySyncTransport per the sync-client test convention —
 * no HTTP, no daemon.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { makeBackupService } from '@/lib/db/backup'
import { makeYeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { BrewDB } from '@/lib/db/schema'
import { SyncPushConflictError, syncOnce } from '@/lib/sync/sync-client'
import type { SyncPayload, SyncPushResult, SyncTransport } from '@/lib/sync/transport'
import { InMemorySyncTransport } from '@/lib/sync/transport'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`sync-modes-${Date.now()}-${n++}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})

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

/** Publish `db`'s state as the transport's canonical via a plain two-way sync. */
async function seedRemote(transport: InMemorySyncTransport, db: BrewDB): Promise<void> {
  await syncOnce({
    transport,
    backup: makeBackupService(db),
    snapshot: async () => {},
    now: '2026-06-01T00:00:00.000Z',
  })
}

describe("syncOnce mode: 'pull-only'", () => {
  it('pulls + merges + snapshots + restores, and NEVER calls push', async () => {
    const transport = new InMemorySyncTransport()
    const dbRemote = freshDb()
    await makeYeastLotsRepo(dbRemote).save(lot({ id: crypto.randomUUID(), strain: 'R-Strain' }))
    await seedRemote(transport, dbRemote)

    const dbLocal = freshDb()
    await makeYeastLotsRepo(dbLocal).save(lot({ id: crypto.randomUUID(), strain: 'L-Strain' }))
    const push = vi.spyOn(transport, 'push')
    const snapshot = vi.fn(async () => {})

    const result = await syncOnce({
      transport,
      backup: makeBackupService(dbLocal),
      snapshot,
      now: '2026-06-02T00:00:00.000Z',
      mode: 'pull-only',
    })

    expect(push).not.toHaveBeenCalled()
    expect(snapshot).toHaveBeenCalledTimes(1) // a restore happened → pre-image taken
    expect(result.pulled).toBe(true)
    expect(result.merged).toBe(true)
    expect(result.pushed).toBe(false)

    // Local converged to the union…
    const strains = (await makeYeastLotsRepo(dbLocal).list()).map((l) => l.strain).sort()
    expect(strains).toEqual(['L-Strain', 'R-Strain'])

    // …but canonical is UNTOUCHED (still only the remote strain).
    const canonical = await transport.pull()
    const remoteStrains = (canonical.payload?.tables.yeastLots ?? []).map((l) => l.strain)
    expect(remoteStrains).toEqual(['R-Strain'])
  })

  it('does NOT seed an empty remote (no first-push), and skips snapshot/restore', async () => {
    const transport = new InMemorySyncTransport()
    const dbLocal = freshDb()
    await makeYeastLotsRepo(dbLocal).save(lot({ id: crypto.randomUUID(), strain: 'L-Strain' }))
    const push = vi.spyOn(transport, 'push')
    const snapshot = vi.fn(async () => {})

    const result = await syncOnce({
      transport,
      backup: makeBackupService(dbLocal),
      snapshot,
      now: '2026-06-02T00:00:00.000Z',
      mode: 'pull-only',
    })

    expect(push).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled() // no remote → no restore → no pre-image needed
    expect(result).toMatchObject({ pulled: false, merged: false, pushed: false })
    expect((await transport.pull()).payload).toBeNull() // remote stays empty
  })
})

describe("syncOnce mode: 'push-only'", () => {
  it('bootstraps an empty store (If-Match empty-sentinel path) without restoring', async () => {
    const transport = new InMemorySyncTransport()
    const dbLocal = freshDb()
    await makeYeastLotsRepo(dbLocal).save(lot({ id: crypto.randomUUID(), strain: 'L-Strain' }))
    const backup = makeBackupService(dbLocal)
    const restore = vi.spyOn(backup, 'restore')
    const snapshot = vi.fn(async () => {})

    const result = await syncOnce({
      transport,
      backup,
      snapshot,
      now: '2026-06-02T00:00:00.000Z',
      mode: 'push-only',
    })

    expect(result).toMatchObject({ pulled: false, merged: false, pushed: true })
    expect(restore).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    const canonical = await transport.pull()
    expect((canonical.payload?.tables.yeastLots ?? []).map((l) => l.strain)).toEqual(['L-Strain'])
  })

  it('replaces a non-empty remote with local state (desktop-is-canonical) and never merges down', async () => {
    const transport = new InMemorySyncTransport()
    const dbRemote = freshDb()
    await makeYeastLotsRepo(dbRemote).save(lot({ id: crypto.randomUUID(), strain: 'R-Strain' }))
    await seedRemote(transport, dbRemote)

    const dbLocal = freshDb()
    await makeYeastLotsRepo(dbLocal).save(lot({ id: crypto.randomUUID(), strain: 'L-Strain' }))
    const backup = makeBackupService(dbLocal)
    const restore = vi.spyOn(backup, 'restore')

    await syncOnce({
      transport,
      backup,
      snapshot: async () => {},
      now: '2026-06-02T00:00:00.000Z',
      mode: 'push-only',
    })

    expect(restore).not.toHaveBeenCalled()
    // Canonical is exactly local — the remote-only strain is gone by design.
    const canonical = await transport.pull()
    expect((canonical.payload?.tables.yeastLots ?? []).map((l) => l.strain)).toEqual(['L-Strain'])
    // Local never gained the remote strain either (no merge down).
    const localStrains = (await makeYeastLotsRepo(dbLocal).list()).map((l) => l.strain)
    expect(localStrains).toEqual(['L-Strain'])
  })

  it('retries a 412 with the etag the rejection surfaced (competing writer), re-dumping local', async () => {
    const shared = new InMemorySyncTransport()
    const dbRemote = freshDb()
    await makeYeastLotsRepo(dbRemote).save(lot({ id: crypto.randomUUID(), strain: 'R-Strain' }))
    await seedRemote(shared, dbRemote)

    // A competing writer lands between our etag observation (pull) and our push:
    // the FIRST pull returns a stale etag from BEFORE the competitor's push.
    let pullCount = 0
    const racy: SyncTransport = {
      pull: async () => {
        const before = await shared.pull()
        pullCount += 1
        if (pullCount === 1) {
          const dbCompetitor = freshDb()
          await makeYeastLotsRepo(dbCompetitor).save(
            lot({ id: crypto.randomUUID(), strain: 'C-Strain' }),
          )
          await seedRemote(shared, dbCompetitor) // bumps the shared etag
        }
        return before // stale by the time the caller pushes
      },
      push: (payload: SyncPayload, ifMatch?: string | null): Promise<SyncPushResult> =>
        shared.push(payload, ifMatch),
    }

    const dbLocal = freshDb()
    await makeYeastLotsRepo(dbLocal).save(lot({ id: crypto.randomUUID(), strain: 'L-Strain' }))

    const result = await syncOnce({
      transport: racy,
      backup: makeBackupService(dbLocal),
      snapshot: async () => {},
      now: '2026-06-03T00:00:00.000Z',
      mode: 'push-only',
    })

    expect(result.pushed).toBe(true)
    // The retry used the CURRENT etag from the 412 — no extra pull needed.
    expect(pullCount).toBe(1)
    const canonical = await shared.pull()
    expect((canonical.payload?.tables.yeastLots ?? []).map((l) => l.strain)).toEqual(['L-Strain'])
  })

  it('throws a typed SyncPushConflictError after exhausting retries against a persistently stale precondition', async () => {
    let pushAttempts = 0
    const alwaysStale: SyncTransport = {
      pull: async () => ({ payload: null, etag: null }),
      push: async (): Promise<SyncPushResult> => {
        pushAttempts += 1
        return { ok: false, status: 412, currentEtag: `"v${pushAttempts}"` }
      },
    }
    const dbLocal = freshDb()
    await makeYeastLotsRepo(dbLocal).save(lot({ id: crypto.randomUUID(), strain: 'L-Strain' }))

    await expect(
      syncOnce({
        transport: alwaysStale,
        backup: makeBackupService(dbLocal),
        snapshot: async () => {},
        now: '2026-06-03T00:00:00.000Z',
        mode: 'push-only',
      }),
    ).rejects.toBeInstanceOf(SyncPushConflictError)
    expect(pushAttempts).toBe(3) // same MAX_PUSH_ATTEMPTS budget as two-way
  })
})

describe("syncOnce mode: 'two-way' (explicit) matches the default", () => {
  it('behaves exactly like omitting mode: pull, merge, restore, push', async () => {
    const transport = new InMemorySyncTransport()
    const dbRemote = freshDb()
    await makeYeastLotsRepo(dbRemote).save(lot({ id: crypto.randomUUID(), strain: 'R-Strain' }))
    await seedRemote(transport, dbRemote)

    const dbLocal = freshDb()
    await makeYeastLotsRepo(dbLocal).save(lot({ id: crypto.randomUUID(), strain: 'L-Strain' }))

    const result = await syncOnce({
      transport,
      backup: makeBackupService(dbLocal),
      snapshot: async () => {},
      now: '2026-06-02T00:00:00.000Z',
      mode: 'two-way',
    })

    expect(result).toMatchObject({ pulled: true, merged: true, pushed: true })
    const canonical = await transport.pull()
    const strains = (canonical.payload?.tables.yeastLots ?? []).map((l) => l.strain).sort()
    expect(strains).toEqual(['L-Strain', 'R-Strain'])
  })
})
