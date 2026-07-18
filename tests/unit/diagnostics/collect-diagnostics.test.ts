import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appMetaRepo } from '@/lib/db/repos/app-meta'
import { db } from '@/lib/db/schema'
import { collectDiagnostics } from '@/lib/diagnostics/collect-diagnostics'
import { clearDiagnosticsRing, recordError } from '@/lib/diagnostics/error-log'
import * as durability from '@/lib/storage/durability'

describe('collectDiagnostics', () => {
  beforeEach(async () => {
    await db.open()
    for (const t of db.tables) await t.clear()
    clearDiagnosticsRing()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const t of db.tables) await t.clear()
    clearDiagnosticsRing()
  })

  it('composes the full read-model shape from E1/E2 primitives on an empty DB', async () => {
    const snap = await collectDiagnostics()
    // Database — 17 tables (appMeta + rowTombstones + deviceLinks included), verno 12
    expect(snap.db.verno).toBe(12)
    expect(snap.db.tables).toHaveLength(17)
    expect(snap.db.tables.map((t) => t.name)).toContain('appMeta')
    expect(snap.db.tables.every((t) => t.count === 0)).toBe(true)
    // Build stamp from version.ts — env unset in test → dev fallback
    expect(snap.build.version).toBe('0.0.0-dev')
    // Storage + SW neutral in node (no navigator.storage/.serviceWorker/caches) — must not throw
    expect(snap.storage.persistence).toBe('unsupported')
    expect(snap.storage.estimate).toBeNull()
    expect(snap.sw.supported).toBe(false)
    expect(snap.sw.precacheVersion).toBeNull()
    // Backup — no record → critical / null age (E1 null branch)
    expect(snap.backup.freshness).toBe('critical')
    expect(snap.backup.ageDays).toBeNull()
    expect(snap.ring).toEqual([])
  })

  it('reflects seeded rows + a fresh backup record + the error ring', async () => {
    await db.recipes.add({ id: 'r1' } as unknown as never) // Dexie stores; Zod is at the repo boundary, not here
    await appMetaRepo.setBackupRecord({
      lastBackupAt: new Date().toISOString(),
      method: 'download',
      bytes: 10,
      rowCounts: {},
      schemaVersion: 1,
    })
    recordError('unit-test', new Error('boom'))
    const snap = await collectDiagnostics()
    expect(snap.db.tables.find((t) => t.name === 'recipes')?.count).toBe(1)
    expect(snap.db.tables.find((t) => t.name === 'appMeta')?.count).toBe(1) // the backupRecord row
    expect(snap.backup.freshness).toBe('fresh')
    expect(snap.backup.method).toBe('download')
    expect(snap.ring.some((e) => e.scope === 'unit-test')).toBe(true)
  })

  it('never rejects when a data source throws — neutralizes that source, keeps the rest', async () => {
    // A diagnostics page is exactly where you want info WHEN things are degraded.
    // Blow up the storage-estimate source; collectDiagnostics must still RESOLVE
    // (not reject → blank spinner) with that field neutralized and the rest populated.
    vi.spyOn(durability, 'getStorageEstimate').mockRejectedValue(new Error('estimate exploded'))
    const snap = await collectDiagnostics()
    // Failed source neutralized to its neutral value
    expect(snap.storage.estimate).toBeNull()
    // Every other source still populates
    expect(snap.db.tables).toHaveLength(17)
    expect(snap.db.verno).toBe(12)
    expect(snap.build.version).toBe('0.0.0-dev')
    expect(snap.storage.persistence).toBe('unsupported')
    expect(snap.sw.supported).toBe(false)
    expect(snap.backup.freshness).toBe('critical')
    expect(snap.ring).toEqual([])
  })
})
