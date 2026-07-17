// @vitest-environment jsdom
/**
 * Pre-sync safety snapshot: `syncOnce` must capture a local backup BEFORE it
 * restores a merged dump into the local DB (the restore is a full replace —
 * without a pre-image, a bad merge has no recovery path; see sync-client.ts
 * module docs). The snapshot fires exactly when a restore WILL happen (a
 * remote exists to merge against) and never on a first solo sync.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import { makeBackupService } from '@/lib/db/backup'
import { appMetaRepo } from '@/lib/db/repos/app-meta'
import { makeYeastLotsRepo } from '@/lib/db/repos/yeast-lots'
import { BrewDB, db } from '@/lib/db/schema'
import { KEEP_LAST, runBackup } from '@/lib/storage/backup-run'
import type { SyncBackup } from '@/lib/sync/sync-client'
import { syncOnce } from '@/lib/sync/sync-client'
import { InMemorySyncTransport } from '@/lib/sync/transport'

let n = 0
const dbs: BrewDB[] = []
function freshDb(): BrewDB {
  const d = new BrewDB(`sync-snap-${Date.now()}-${n++}`)
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

describe('syncOnce — pre-restore safety snapshot timing', () => {
  it('does NOT call snapshot on a first sync (remote is null → no restore happens)', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    await makeYeastLotsRepo(dbA).save(lot({ id: crypto.randomUUID() }))

    let called = 0
    const result = await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: async () => {
        called++
      },
      now: '2026-06-01T00:00:00.000Z',
    })

    expect(result.pulled).toBe(false)
    expect(called).toBe(0)
  })

  it('calls snapshot BEFORE backup.restore whenever a remote exists (a restore WILL happen)', async () => {
    const transport = new InMemorySyncTransport()
    const dbA = freshDb()
    const dbB = freshDb()
    await makeYeastLotsRepo(dbA).save(lot({ id: crypto.randomUUID(), strain: 'A-Strain' }))
    await makeYeastLotsRepo(dbB).save(lot({ id: crypto.randomUUID(), strain: 'B-Strain' }))

    // A's first sync — no remote yet, publishes A.
    await syncOnce({
      transport,
      backup: makeBackupService(dbA),
      snapshot: async () => {},
      now: '2026-06-01T00:00:00.000Z',
    })

    const order: string[] = []
    const real = makeBackupService(dbB)
    const spiedBackup: SyncBackup = {
      dump: () => real.dump(),
      restore: async (d) => {
        order.push('restore')
        await real.restore(d)
      },
    }

    const result = await syncOnce({
      transport,
      backup: spiedBackup,
      snapshot: async () => {
        order.push('snapshot')
      },
      now: '2026-06-01T00:01:00.000Z',
    })

    expect(result.merged).toBe(true)
    expect(order).toEqual(['snapshot', 'restore'])
  })
})

describe('syncOnce — snapshot wired to the real runBackup (reuses KEEP_LAST rotation)', () => {
  beforeEach(async () => {
    await db.open()
    await db.appMeta.clear()
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    ;(window as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve()
  })
  afterEach(async () => {
    await db.appMeta.clear()
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
    vi.restoreAllMocks()
  })

  function seededFolderHandle(seedNames: string[]) {
    const files = new Set<string>(seedNames)
    return {
      kind: 'directory' as const,
      name: 'brew-backups',
      queryPermission: async () => 'granted' as PermissionState,
      async getFileHandle(name: string) {
        files.add(name)
        return {
          async createWritable() {
            return { async write() {}, async close() {} }
          },
        }
      },
      async removeEntry(name: string) {
        files.delete(name)
      },
      async *[Symbol.asyncIterator]() {
        for (const name of files) yield [name, { kind: 'file' }] as [string, { kind: string }]
      },
      _files: files,
    } as unknown as FileSystemDirectoryHandle & { _files: Set<string> }
  }

  it('does not grow the backup folder unbounded — a triggered snapshot still prunes to KEEP_LAST', async () => {
    // Pre-seed MORE than KEEP_LAST stale backup files (as if many prior manual/
    // launch backups had accumulated) — proves our snapshot hook reuses the
    // EXISTING rotation instead of reimplementing unbounded storage.
    const seeded = Array.from(
      { length: KEEP_LAST + 2 },
      (_, i) => `beer-lab-ware-backup-2020-01-${String(i + 1).padStart(2, '0')}.json`,
    )
    const handle = seededFolderHandle(seeded)
    vi.spyOn(appMetaRepo, 'getDirHandle').mockResolvedValue(handle)

    const transport = new InMemorySyncTransport()
    // Seed a remote directly (bypassing syncOnce) so THIS sync merges → restores
    // → triggers exactly one snapshot.
    await transport.push(await makeBackupService(db).dump())

    await syncOnce({
      transport,
      backup: makeBackupService(db),
      snapshot: () => runBackup(),
      now: '2026-06-01T00:00:00.000Z',
    })

    expect(handle._files.size).toBe(KEEP_LAST)
  })
})
