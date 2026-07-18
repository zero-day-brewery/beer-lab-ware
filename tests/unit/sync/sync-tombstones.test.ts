/**
 * Deletion tombstones for the two-way sync merge (see sync/merge.ts's
 * `mergeState`/`mergeLedger`/`mergeTombstones` + the tombstone-aware
 * orchestration in `mergeDumpTables`/`syncOnce` below). Before this feature,
 * `mergeState`/`mergeLedger` unioned rows by id with NO way to tell "deleted
 * elsewhere" apart from "never existed here" — a row deleted on one device
 * was resurrected from another device's stale, pre-delete copy on the very
 * next two-way merge (see the KNOWN LIMITATION this closes, sync-client.ts).
 *
 * Covers, end to end through `syncOnce` (real Dexie DBs + repos, exactly as
 * the app calls them) AND precisely through `mergeDumpTables` (pure, easy to
 * pin `now` for GC): resurrection, cascade-deleted ledger rows, edit-after-
 * delete symmetry, the restore-clears-tombstones path, and tombstone GC.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { InventoryItem } from '@/lib/brewing/types/inventory'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { StockTransaction } from '@/lib/brewing/types/stock-transaction'
import { type DumpV9, type DumpV10, makeBackupService } from '@/lib/db/backup'
import { makeBatchRepo } from '@/lib/db/repos/batch'
import { makeDeviceLinksRepo } from '@/lib/db/repos/device-links'
import { makeInventoryRepo } from '@/lib/db/repos/inventory'
import { makeRecipeRepo } from '@/lib/db/repos/recipe'
import { BrewDB } from '@/lib/db/schema'
import { assertLedgerInvariant, emptyCollections } from '@/lib/node/brewery-store'
import { mergeDumpTables, syncOnce } from '@/lib/sync/sync-client'
import { InMemorySyncTransport } from '@/lib/sync/transport'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`sync-tombstones-${Date.now()}-${n++}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
})

const noopSnapshot = async () => {}

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

function emptyTables(): DumpV10['tables'] {
  return {
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
    rowTombstones: [],
    deviceLinks: [],
  }
}

describe('tombstones stop a resurrection (the bug this feature closes)', () => {
  it('a recipe deleted on device A stays deleted on both devices after a full convergence round, even though B never learned of the delete before A re-syncs', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const id = crypto.randomUUID()
    const r = recipe({ id })
    await dbA.recipes.put(r)
    await dbB.recipes.put(r)

    // Converge once so canonical + both devices agree on the recipe existing.
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })

    // A deletes it (repo.delete writes the tombstone atomically) and syncs.
    await makeRecipeRepo(dbA).delete(id)
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-02T00:00:00.000Z',
    })

    // B syncs WITHOUT having learned about the delete first — pulls A's
    // tombstone, merges against its own stale (pre-delete, older) local copy.
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-02T00:01:00.000Z',
    })
    expect(await dbB.recipes.get(id)).toBeUndefined()

    // A second convergence round: A pulls whatever B just pushed — must STAY
    // deleted (the historical bug: B's surviving copy would resurrect it here).
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-02T00:02:00.000Z',
    })
    expect(await dbA.recipes.get(id)).toBeUndefined()
  })

  it('a deviceLink (sensor-device assignment) deleted on device A stays deleted after a full convergence round — same LWW/tombstone merge every state table gets, proven for the new table', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const batchId = crypto.randomUUID()
    const link = await makeDeviceLinksRepo(dbA).assign('tilt:RED', batchId)
    await dbB.deviceLinks.put(link) // B's stale pre-delete copy

    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })

    await makeDeviceLinksRepo(dbA).remove(link.id)
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-02T00:00:00.000Z',
    })

    // B syncs against A's tombstone with only its OWN stale, older copy —
    // must be suppressed, not resurrected.
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-02T00:01:00.000Z',
    })
    expect(await dbB.deviceLinks.get(link.id)).toBeUndefined()

    // Reassigning the SAME deviceKey to a different batch (a fresh row, newer
    // than the tombstone) must survive the next merge — edit-after-delete,
    // same symmetry every other table gets.
    const reassigned = await makeDeviceLinksRepo(dbB).assign('tilt:RED', crypto.randomUUID())
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-03T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-03T00:01:00.000Z',
    })
    expect((await dbA.deviceLinks.get(reassigned.id))?.batchId).toBe(reassigned.batchId)
  })
})

describe('cascade: deleting an inventory item tombstones its ledger rows too', () => {
  it('the item AND its ledger rows stay gone on both devices after merge; the ledger invariant holds', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const id = crypto.randomUUID()
    const item = {
      id,
      name: 'Cascade',
      ingredientKind: 'hop' as const,
      amount: 100,
      amountUnit: 'g' as const,
      status: 'sealed' as const,
      notes_md: '',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      schemaVersion: 1 as const,
    }
    const openingTxn = {
      id: crypto.randomUUID(),
      inventoryItemId: id,
      kind: 'hop' as const,
      delta: 100,
      unit: 'g' as const,
      reason: 'opening' as const,
      at: '2026-05-01T00:00:00.000Z',
      schemaVersion: 1 as const,
    }
    for (const db of [dbA, dbB]) {
      await db.inventoryItems.put(item)
      await db.stockTransactions.put(openingTxn)
    }
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })

    // A deletes the item — cascades the ledger delete + tombstones both.
    await makeInventoryRepo(dbA).delete(id)
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
      now: '2026-06-02T00:01:00.000Z',
    })

    for (const db of [dbA, dbB]) {
      expect(await db.inventoryItems.get(id)).toBeUndefined()
      expect(await db.stockTransactions.where('inventoryItemId').equals(id).count()).toBe(0)
    }
  })
})

describe('cascade: deleting a batch tombstones its deviceLinks too', () => {
  it('a deviceLink cascade-tombstoned by its BATCH being deleted (not a direct link delete) stays gone on both devices after a full convergence round — the F1 fix: propagates through sync exactly like the direct-delete case above', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const batchId = crypto.randomUUID()
    const b = {
      id: batchId,
      batchNo: 1,
      name: 'Cascade Batch',
      status: 'in-progress' as const,
      process: [],
      logs: [],
      timers: [],
      results: {},
      startedAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      schemaVersion: 1 as const,
    }
    for (const db of [dbA, dbB]) await db.batches.put(b)
    const link = await makeDeviceLinksRepo(dbA).assign('tilt:RED', batchId)
    await dbB.deviceLinks.put(link) // B's stale pre-delete copy

    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })

    // A deletes the BATCH (never touches deviceLinks directly) — batchRepo's
    // cascade (repos/batch.ts) tombstones the link in the SAME transaction.
    await makeBatchRepo(dbA).delete(batchId)
    expect(await dbA.deviceLinks.get(link.id)).toBeUndefined() // cascaded locally already

    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-02T00:00:00.000Z',
    })

    // B syncs against A's CASCADE tombstone with only its own stale, older
    // copy of the link — must be suppressed, not resurrected, proving the
    // cascade tombstone propagates through the merge exactly like a direct
    // repo.remove() tombstone does.
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-02T00:01:00.000Z',
    })
    expect(await dbB.batches.get(batchId)).toBeUndefined()
    expect(await dbB.deviceLinks.get(link.id)).toBeUndefined()
  })
})

// ── Adversarial-review fix (E2/#14): readings of a tombstoned batch die with
// it. A reading ingested during delete-propagation lag has an `at` AFTER the
// batch tombstone's `deletedAt`, so per-row suppression (at-or-before by
// design, for edit-after-delete) can never catch it — pre-fix it survived as
// a PERMANENT orphan (doctor C3 red, no UI to remove it). ────────────────────
describe('cascade at merge time: readings of a batch that stayed tombstoned die with it', () => {
  const batchId = '55555555-5555-4555-8555-555555555555'
  const deletedAt = '2026-06-01T00:00:00.000Z'
  const staleBatch = {
    id: batchId,
    batchNo: 1,
    name: 'Deleted On The Phone',
    status: 'in-progress' as const,
    process: [],
    logs: [],
    timers: [],
    results: {},
    startedAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z', // strictly BEFORE deletedAt — the batch stays dead
    schemaVersion: 1 as const,
  }
  const lateReading = {
    id: crypto.randomUUID(),
    batchId,
    at: '2026-06-02T00:00:00.000Z', // strictly AFTER deletedAt — per-row suppression can't catch it
    gravity: 1.018,
    tempC: 19,
    source: 'tilt' as const,
    schemaVersion: 1 as const,
  }

  it('phone deletes the batch; the daemon ingests a reading AFTER the delete — the merge yields neither the batch nor the orphan reading (membership, not timestamp)', () => {
    // Phone's perspective: it deleted the batch (tombstone only). Its remote
    // pull is the daemon's canonical — the stale batch plus a reading the
    // daemon ingested during delete-propagation lag.
    const local = {
      ...emptyTables(),
      rowTombstones: [{ id: batchId, table: 'batches', deletedAt }],
    }
    const remote = { ...emptyTables(), batches: [staleBatch], readings: [lateReading] }
    const merged = mergeDumpTables(local, remote)
    expect(merged.batches).toEqual([]) // suppressed by its own tombstone, as before
    expect(merged.readings).toEqual([]) // pre-fix: survived forever — its `at` beat `deletedAt`
    expect(merged.rowTombstones).toHaveLength(1) // the batch tombstone still stands
  })

  it("the batch surviving via edit-after-delete keeps its readings — the only thing that saves a reading is its batch ITSELF surviving, never the reading's own `at`", () => {
    const revivedBatch = { ...staleBatch, updatedAt: '2026-06-03T00:00:00.000Z' } // strictly AFTER deletedAt
    const local = {
      ...emptyTables(),
      rowTombstones: [{ id: batchId, table: 'batches', deletedAt }],
    }
    const remote = { ...emptyTables(), batches: [revivedBatch], readings: [lateReading] }
    const merged = mergeDumpTables(local, remote)
    expect(merged.batches).toHaveLength(1) // edit-after-delete beat the tombstone
    expect(merged.readings).toHaveLength(1) // its readings live exactly as long as it does
    expect(merged.rowTombstones).toEqual([]) // superseded, dropped
  })
})

describe('edit-after-delete symmetry (LWW beats the tombstone)', () => {
  it('a device editing the row AFTER another device deleted it: the edit survives on both, the tombstone is dropped', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    const id = crypto.randomUUID()
    const original = recipe({ id, name: 'Original', updatedAt: '2026-06-01T00:00:00.000Z' })
    await dbA.recipes.put(original)
    await dbB.recipes.put(original)
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:01:00.000Z',
    })

    // A deletes it — `recipeRepo.delete` stamps `deletedAt` from the REAL wall
    // clock (not the fictional `now` passed to syncOnce below, which only
    // times the sync PASS itself) — read it back so B's edit can be pinned
    // strictly after it, deterministically, rather than guessing at real time.
    await makeRecipeRepo(dbA).delete(id)
    const realDeletedAt = (await dbA.rowTombstones.get(id))?.deletedAt as string
    const editedAt = new Date(Date.parse(realDeletedAt) + 60_000).toISOString()
    // B edits AFTER that (real-clock-ordered), but before B ever pulls A's delete.
    await dbB.recipes.put({ ...original, name: 'Edited by B', updatedAt: editedAt })

    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-05T00:00:00.000Z',
    })
    await syncOnce({
      transport,
      backup: makeBackupService(dbB),
      snapshot: noopSnapshot,
      now: '2026-06-06T00:00:00.000Z',
    })
    // A converges again — must see B's surviving edit, not "still deleted".
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-07T00:00:00.000Z',
    })

    expect((await dbA.recipes.get(id))?.name).toBe('Edited by B')
    expect((await dbB.recipes.get(id))?.name).toBe('Edited by B')
  })

  it('mergeDumpTables: precisely drops the superseded tombstone when the surviving row beats it', () => {
    const id = crypto.randomUUID()
    const local = {
      ...emptyTables(),
      rowTombstones: [{ id, table: 'recipes', deletedAt: '2026-06-05T00:00:00.000Z' }],
    }
    const remote = {
      ...emptyTables(),
      recipes: [recipe({ id, updatedAt: '2026-06-06T00:00:00.000Z' })], // strictly after deletedAt
    }
    const merged = mergeDumpTables(local, remote)
    expect(merged.recipes).toHaveLength(1)
    expect(merged.rowTombstones).toEqual([]) // superseded, dropped
  })

  it('mergeDumpTables: an exact-tie timestamp is still suppressed by the tombstone', () => {
    const id = crypto.randomUUID()
    const local = {
      ...emptyTables(),
      rowTombstones: [{ id, table: 'recipes', deletedAt: '2026-06-05T00:00:00.000Z' }],
    }
    const remote = {
      ...emptyTables(),
      recipes: [recipe({ id, updatedAt: '2026-06-05T00:00:00.000Z' })], // exact tie
    }
    const merged = mergeDumpTables(local, remote)
    expect(merged.recipes).toEqual([])
    expect(merged.rowTombstones).toHaveLength(1) // still needed, kept
  })
})

// ── Adversarial-review fix (F2): restore() must beat a REMOTE canonical
// tombstone too, not just the local copy it prunes — else the very next
// sync silently re-deletes the row, contradicting the destructive-replace
// intent of a restore. ───────────────────────────────────────────────────
describe('restore path: a genuine backup IMPORT must survive a remote canonical tombstone (not just the local one it prunes)', () => {
  it('bumpTimestamps: true — the restored row beats a remote tombstone whose deletedAt postdates the backup, fleet-wide (canonical itself reflects the win)', async () => {
    const dbA = freshDb()
    const id = crypto.randomUUID()
    const original = recipe({ id, name: 'Old Ale', updatedAt: '2026-05-01T00:00:00.000Z' })
    await dbA.recipes.put(original)
    const backup = await makeBackupService(dbA).dump() // "the backup taken" — recipe at its OLD updatedAt

    // Canonical: ANOTHER device deleted this recipe AFTER the backup was
    // taken, and that deletion reached the sync daemon. The restoring
    // device's own local tombstone-prune (backup.ts's `restoredIds`) can
    // never touch this remote copy — only a re-sync can.
    const transport = new InMemorySyncTransport()
    const canonical: DumpV10 = {
      version: 10,
      exportedAt: '2026-06-05T00:00:00.000Z',
      meta: { dumpVersion: 10, dbVersion: 12, schemaVersion: 1, rowCounts: {} },
      tables: {
        ...emptyTables(),
        rowTombstones: [{ id, table: 'recipes', deletedAt: '2026-06-01T00:00:00.000Z' }], // AFTER the backup's updatedAt
      },
    }
    await transport.push(canonical, null)

    // The user restores the OLD backup — the genuine "Import backup" UI path
    // (data-section.tsx), which opts into the timestamp bump.
    await makeBackupService(dbA).restore(backup, { bumpTimestamps: true })
    expect(await dbA.recipes.get(id)).toBeDefined() // survives locally (trivial — local tombstone pruned)

    // The critical proof: sync against the REMOTE canonical tombstone. Without
    // the bump, the row's ORIGINAL (pre-restore, pre-delete) updatedAt would
    // lose to the remote tombstone's deletedAt and vanish again.
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-07-01T00:00:00.000Z',
    })
    expect(await dbA.recipes.get(id)).toBeDefined()

    // "on both sides": canonical itself now reflects the restore winning —
    // the remote tombstone was superseded, not just locally ignored.
    const pulled = await transport.pull()
    expect(pulled.payload?.tables.recipes.some((r) => r.id === id)).toBe(true)
    expect(pulled.payload?.tables.rowTombstones.some((t) => t.id === id)).toBe(false)
  })

  it('bumpTimestamps defaults to false — the internal sync-merge restore path (pullMergeRestore) never bumps, so LWW ordering across devices is unaffected by routine syncing', async () => {
    const dbA = freshDb()
    const id = crypto.randomUUID()
    const original = recipe({ id, updatedAt: '2026-05-01T00:00:00.000Z' })
    await dbA.recipes.put(original)
    // restore() with NO opts (the default `syncOnce` uses internally) must
    // leave updatedAt untouched.
    const dump = await makeBackupService(dbA).dump()
    await makeBackupService(dbA).restore(dump)
    expect((await dbA.recipes.get(id))?.updatedAt).toBe('2026-05-01T00:00:00.000Z')
  })
})

describe('restore path: a full restore clears tombstones for rows it re-creates', () => {
  it('a device that deletes a recipe, then restores an OLDER backup containing it, keeps the recipe on the next sync (no stale local tombstone re-kills it)', async () => {
    const dbA = freshDb()
    const id = crypto.randomUUID()
    const r = recipe({ id, name: 'Old Ale' })
    await dbA.recipes.put(r)
    await makeRecipeRepo(dbA).delete(id)
    expect(await dbA.rowTombstones.get(id)).toBeDefined()

    // User imports an old (genuinely pre-deviceLinks) v9 backup that predates
    // the deletion.
    const { deviceLinks: _omitDeviceLinks, ...v9Tables } = emptyTables()
    const oldDump: DumpV9 = {
      version: 9,
      exportedAt: '2026-05-02T00:00:00.000Z',
      meta: { dumpVersion: 9, dbVersion: 11, schemaVersion: 1, rowCounts: {} },
      tables: { ...v9Tables, recipes: [r] },
    }
    await makeBackupService(dbA).restore(oldDump)
    expect(await dbA.recipes.get(id)).toBeDefined()
    expect(await dbA.rowTombstones.get(id)).toBeUndefined()

    // Sync afterward must not re-delete it (no stale tombstone survives to fight it).
    const transport = new InMemorySyncTransport()
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: noopSnapshot,
      now: '2026-06-01T00:00:00.000Z',
    })
    expect(await dbA.recipes.get(id)).toBeDefined()
  })
})

describe('tombstone GC (bounded growth)', () => {
  const RETENTION_MS = 180 * 24 * 60 * 60 * 1000

  it('drops a stale (>180d) tombstone that no longer matches a row in either input', () => {
    const id = crypto.randomUUID()
    const deletedAt = '2026-01-01T00:00:00.000Z'
    const now = new Date(Date.parse(deletedAt) + RETENTION_MS + 1000).toISOString()
    const local = { ...emptyTables(), rowTombstones: [{ id, table: 'recipes', deletedAt }] }
    const remote = emptyTables()
    const merged = mergeDumpTables(local, remote, now)
    expect(merged.rowTombstones).toEqual([])
  })

  it('keeps a stale (>180d) tombstone that is STILL suppressing a row present in one input (a device that has not synced the delete yet)', () => {
    const id = crypto.randomUUID()
    const deletedAt = '2026-01-01T00:00:00.000Z'
    const now = new Date(Date.parse(deletedAt) + RETENTION_MS + 1000).toISOString()
    const staleRow = recipe({ id, updatedAt: '2025-12-01T00:00:00.000Z' }) // strictly before deletedAt
    const local = { ...emptyTables(), rowTombstones: [{ id, table: 'recipes', deletedAt }] }
    const remote = { ...emptyTables(), recipes: [staleRow] }
    const merged = mergeDumpTables(local, remote, now)
    expect(merged.rowTombstones).toHaveLength(1)
    expect(merged.recipes).toEqual([]) // still suppressed in this merge's own output
  })

  it('does NOT drop a tombstone younger than the retention window even with no matching row anywhere', () => {
    const id = crypto.randomUUID()
    const deletedAt = '2026-06-01T00:00:00.000Z'
    const now = new Date(Date.parse(deletedAt) + 1000).toISOString() // 1s old, nowhere near 180d
    const local = { ...emptyTables(), rowTombstones: [{ id, table: 'recipes', deletedAt }] }
    const remote = emptyTables()
    const merged = mergeDumpTables(local, remote, now)
    expect(merged.rowTombstones).toHaveLength(1)
  })
})

// ── Adversarial-review fix (F1): a surviving item whose ledger cascade was
// wiped by ANOTHER device's delete must never wedge amount !== Σdeltas. ────
describe('reprojectAmounts: a surviving item with a fully-cascaded ledger reconciles instead of wedging', () => {
  function item(over: Partial<InventoryItem> & { id: string }): InventoryItem {
    return {
      name: 'Cascade',
      ingredientKind: 'hop',
      amount: 100,
      amountUnit: 'g',
      status: 'sealed',
      notes_md: '',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      schemaVersion: 1,
      ...over,
    }
  }

  it('device B cascade-deletes item X; device A edits X after the delete — X survives with ZERO surviving ledger rows, and the merge still satisfies amount === Σdeltas on BOTH devices, deduping the reconcile txn on cross-merge', () => {
    const itemId = crypto.randomUUID()
    const openingId = crypto.randomUUID()
    const deletedAt = '2026-06-01T00:00:00.000Z' // B's cascade-delete time
    const editedAt = '2026-06-05T00:00:00.000Z' // A's edit — strictly AFTER the delete

    const opening: StockTransaction = {
      id: openingId,
      inventoryItemId: itemId,
      kind: 'hop',
      delta: 100,
      unit: 'g',
      reason: 'opening',
      at: '2026-05-01T00:00:00.000Z', // strictly BEFORE the delete — this is what gets cascade-tombstoned
      schemaVersion: 1,
    }
    const editedItem = item({ id: itemId, name: 'Cascade (renamed by A)', updatedAt: editedAt })

    // Device A's perspective: A never deleted anything — A still has the
    // item (now edited) AND its original shared ledger row. A's remote pull
    // is B's canonical: item + opening txn ABSENT, both tombstoned at `deletedAt`.
    const aLocal = { ...emptyTables(), inventoryItems: [editedItem], stockTransactions: [opening] }
    const aRemote = {
      ...emptyTables(),
      rowTombstones: [
        { id: itemId, table: 'inventoryItems', deletedAt },
        { id: openingId, table: 'stockTransactions', deletedAt },
      ],
    }
    const mergedA = mergeDumpTables(aLocal, aRemote)

    // Device B's perspective — SYMMETRIC, computed with no knowledge of A's result.
    const bLocal = {
      ...emptyTables(),
      rowTombstones: [
        { id: itemId, table: 'inventoryItems', deletedAt },
        { id: openingId, table: 'stockTransactions', deletedAt },
      ],
    }
    const bRemote = { ...emptyTables(), inventoryItems: [editedItem], stockTransactions: [opening] }
    const mergedB = mergeDumpTables(bLocal, bRemote)

    for (const merged of [mergedA, mergedB]) {
      expect(merged.inventoryItems).toHaveLength(1)
      expect(merged.inventoryItems[0].id).toBe(itemId)
      // The item survived edit-after-delete — its amount is PRESERVED (100),
      // never silently zeroed just because its ledger history was cascaded away.
      expect(merged.inventoryItems[0].amount).toBe(100)
      const reconTxns = merged.stockTransactions.filter((t) => t.reason === 'sync-reconcile')
      expect(reconTxns).toHaveLength(1)
      expect(reconTxns[0].delta).toBe(100) // restarts the ledger at the surviving amount
      expect(reconTxns[0].inventoryItemId).toBe(itemId)
      const sum = merged.stockTransactions
        .filter((t) => t.inventoryItemId === itemId)
        .reduce((s, t) => s + t.delta, 0)
      expect(sum).toBe(100) // amount === Σdeltas holds — the exact invariant the daemon gates on

      const collections = {
        ...emptyCollections(),
        inventoryItems: merged.inventoryItems,
        stockTransactions: merged.stockTransactions,
      }
      expect(() => assertLedgerInvariant(collections)).not.toThrow()
    }

    // Byte-identical compensation, independently derived (same dedup guarantee
    // as the existing negative-sum reconcile mechanism).
    const reconA = mergedA.stockTransactions.find((t) => t.reason === 'sync-reconcile')
    const reconB = mergedB.stockTransactions.find((t) => t.reason === 'sync-reconcile')
    expect(reconA).toEqual(reconB)

    // A third merge round — the two devices' results meeting — must NOT
    // double the compensation.
    const round2 = mergeDumpTables(mergedA, mergedB)
    const recon2 = round2.stockTransactions.filter((t) => t.reason === 'sync-reconcile')
    expect(recon2).toHaveLength(1)
    expect(round2.inventoryItems[0].amount).toBe(100)
    const collections2 = {
      ...emptyCollections(),
      inventoryItems: round2.inventoryItems,
      stockTransactions: round2.stockTransactions,
    }
    expect(() => assertLedgerInvariant(collections2)).not.toThrow()
  })
})
