/**
 * push-only × daemon-ingested readings (adversarial-review fix E1/#12).
 *
 * A `'push-only'` device publishes local state over canonical — but the sync
 * daemon's `POST /readings` (reading-ingest.ts) appends readings straight to
 * CANONICAL between this device's passes, and a push-only device never pulls
 * them down, so they may exist NOWHERE else. Before the fix, `pushOnly()`
 * published the raw local dump (and on 412 retried with the fresh etag but the
 * same local dump), permanently destroying exactly the reading that caused the
 * collision. The fix grafts canonical-only readings into the outgoing dump via
 * `graftDaemonReadings` (sync-client.ts) — reusing `mergeState`'s union +
 * tombstone suppression, never a second hand-rolled union.
 *
 * Covers: the graft on a plain publish, tombstone authority (a locally-deleted
 * reading stays dead), the 412-retry re-pulling etag + STATE as a pair so the
 * colliding reading survives, and the batch-missing edge (dropped + surfaced
 * as `orphanReadingsDropped`, never published as an instant doctor-C3 orphan).
 * All driven through InMemorySyncTransport per the sync-client test convention
 * — no HTTP, no daemon.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Reading } from '@/lib/brewing/types/reading'
import { makeBackupService } from '@/lib/db/backup'
import { makeReadingsRepo } from '@/lib/db/repos/readings'
import { BrewDB } from '@/lib/db/schema'
import { syncOnce } from '@/lib/sync/sync-client'
import type { SyncPayload, SyncTransport } from '@/lib/sync/transport'
import { InMemorySyncTransport } from '@/lib/sync/transport'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`sync-push-only-readings-${Date.now()}-${n++}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})

function batch(id: string) {
  return {
    id,
    batchNo: 1,
    name: 'Sensor Batch',
    status: 'in-progress' as const,
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1 as const,
  }
}

function reading(over: Partial<Reading> & { id: string; batchId: string }): Reading {
  return {
    at: '2026-07-05T00:00:00.000Z',
    gravity: 1.02,
    tempC: 19,
    schemaVersion: 1,
    ...over,
  }
}

/** Simulate the daemon's `POST /readings` (reading-ingest.ts): append a
 *  reading straight to CANONICAL — the store the daemon owns — bumping the
 *  etag exactly like a real ingest write does. */
async function daemonIngest(transport: InMemorySyncTransport, r: Reading): Promise<void> {
  const { payload, etag } = await transport.pull()
  if (!payload) throw new Error('daemonIngest requires seeded canonical state')
  const next: SyncPayload = {
    ...payload,
    tables: { ...payload.tables, readings: [...(payload.tables.readings ?? []), r] },
  }
  const res = await transport.push(next, etag)
  if (!res.ok) throw new Error('daemonIngest push rejected')
}

async function pushOnlyOnce(transport: SyncTransport, db: BrewDB, now: string) {
  return syncOnce({
    transport,
    backup: makeBackupService(db),
    snapshot: async () => {},
    now,
    mode: 'push-only',
  })
}

describe("push-only preserves daemon-ingested readings (the #12 fix: local is canonical for what the USER authors, not for the daemon's appends)", () => {
  it("a reading the daemon ingested into canonical after this device's last pull survives a push-only publish (grafted, not clobbered)", async () => {
    const transport = new InMemorySyncTransport()
    const dbLocal = freshDb()
    const batchId = crypto.randomUUID()
    const manual = reading({ id: crypto.randomUUID(), batchId, note: 'hand-entered' })
    await dbLocal.batches.put(batch(batchId))
    await makeReadingsRepo(dbLocal).create(manual)
    await pushOnlyOnce(transport, dbLocal, '2026-07-05T00:00:00.000Z') // seed canonical

    // The daemon ingests R between this device's passes — R now exists ONLY
    // in canonical (a push-only device never pulls it down).
    const daemonReading = reading({
      id: crypto.randomUUID(),
      batchId,
      at: '2026-07-06T00:00:00.000Z',
      source: 'tilt',
      deviceId: 'RED',
    })
    await daemonIngest(transport, daemonReading)

    const result = await pushOnlyOnce(transport, dbLocal, '2026-07-07T00:00:00.000Z')

    expect(result.pushed).toBe(true)
    expect(result.orphanReadingsDropped).toBe(0)
    const canonical = await transport.pull()
    const ids = (canonical.payload?.tables.readings ?? []).map((r) => r.id).sort()
    expect(ids).toEqual([manual.id, daemonReading.id].sort()) // BOTH survive — pre-fix, R was destroyed
    // Push-only still never merges down: R was preserved in CANONICAL, not
    // pulled into this device's local store.
    expect(await dbLocal.readings.get(daemonReading.id)).toBeUndefined()
  })

  it('a locally-deleted (tombstoned) reading stays dead — the graft never resurrects what the user deleted here', async () => {
    const transport = new InMemorySyncTransport()
    const dbLocal = freshDb()
    const batchId = crypto.randomUUID()
    const doomed = reading({ id: crypto.randomUUID(), batchId })
    await dbLocal.batches.put(batch(batchId))
    await makeReadingsRepo(dbLocal).create(doomed)
    await pushOnlyOnce(transport, dbLocal, '2026-07-05T00:00:00.000Z') // canonical now holds `doomed`

    // User deletes it locally (repo writes the tombstone atomically). The
    // canonical copy is now exactly the stale-pre-delete shape the graft's
    // union sees — it must be suppressed, not re-grafted.
    await makeReadingsRepo(dbLocal).delete(doomed.id)
    const result = await pushOnlyOnce(transport, dbLocal, '2026-07-06T00:00:00.000Z')

    expect(result.pushed).toBe(true)
    expect(result.orphanReadingsDropped).toBe(0) // suppressed-by-tombstone is NOT an orphan drop
    const canonical = await transport.pull()
    expect((canonical.payload?.tables.readings ?? []).some((r) => r.id === doomed.id)).toBe(false)
  })

  it('the 412-retry path re-pulls etag + STATE as a pair, preserving the very reading whose ingest caused the collision', async () => {
    const shared = new InMemorySyncTransport()
    const dbLocal = freshDb()
    const batchId = crypto.randomUUID()
    await dbLocal.batches.put(batch(batchId))
    await pushOnlyOnce(shared, dbLocal, '2026-07-05T00:00:00.000Z') // seed canonical

    // The daemon's ingest lands AFTER this device observes the etag (pull)
    // but BEFORE its push — the classic 412 race, where the winning write IS
    // the reading that must survive the retry.
    const collided = reading({
      id: crypto.randomUUID(),
      batchId,
      at: '2026-07-06T00:00:00.000Z',
      source: 'ispindel',
      deviceId: 'iSpindel001',
    })
    let pullCount = 0
    const racy: SyncTransport = {
      pull: async () => {
        const before = await shared.pull()
        pullCount += 1
        if (pullCount === 1) await daemonIngest(shared, collided) // stale-ifies `before`
        return before
      },
      push: (payload, ifMatch) => shared.push(payload, ifMatch),
    }

    const result = await pushOnlyOnce(racy, dbLocal, '2026-07-07T00:00:00.000Z')

    expect(result.pushed).toBe(true)
    // The retry RE-PULLED (2 pulls total) rather than trusting the 412's
    // currentEtag alone — the rejection surfaces the winning etag but not the
    // winning STATE, which is what holds the reading to preserve.
    expect(pullCount).toBe(2)
    const canonical = await shared.pull()
    expect((canonical.payload?.tables.readings ?? []).some((r) => r.id === collided.id)).toBe(true)
  })

  it('a daemon reading whose batch is absent from the outgoing dump is dropped (never published as an instant orphan) and surfaced in orphanReadingsDropped', async () => {
    const transport = new InMemorySyncTransport()
    const dbLocal = freshDb()
    const keptBatchId = crypto.randomUUID()
    await dbLocal.batches.put(batch(keptBatchId))
    await pushOnlyOnce(transport, dbLocal, '2026-07-05T00:00:00.000Z') // seed canonical

    // Two daemon ingests: one for a batch this device publishes, one for a
    // batch that does NOT exist in the outgoing dump (e.g. deleted locally,
    // delete-propagation lag) — grafting the latter would mint a doctor-C3
    // orphan with no UI to remove it.
    const grafted = reading({
      id: crypto.randomUUID(),
      batchId: keptBatchId,
      at: '2026-07-06T00:00:00.000Z',
      source: 'tilt',
    })
    const orphaned = reading({
      id: crypto.randomUUID(),
      batchId: crypto.randomUUID(), // no such batch in the outgoing dump
      at: '2026-07-06T01:00:00.000Z',
      source: 'tilt',
    })
    await daemonIngest(transport, grafted)
    await daemonIngest(transport, orphaned)

    const result = await pushOnlyOnce(transport, dbLocal, '2026-07-07T00:00:00.000Z')

    expect(result.pushed).toBe(true)
    expect(result.orphanReadingsDropped).toBe(1)
    const canonical = await transport.pull()
    const ids = (canonical.payload?.tables.readings ?? []).map((r) => r.id)
    expect(ids).toContain(grafted.id)
    expect(ids).not.toContain(orphaned.id)
  })
})
