import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackupRecord } from '@/lib/brewing/types/backup-meta'
import { makeAppMetaRepo } from '@/lib/db/repos/app-meta'
import { BrewDB } from '@/lib/db/schema'

describe('appMetaRepo', () => {
  let db: BrewDB
  let repo: ReturnType<typeof makeAppMetaRepo>

  beforeEach(async () => {
    db = new BrewDB('test-app-meta')
    await db.open()
    repo = makeAppMetaRepo(db)
  })
  afterEach(async () => {
    db.close()
    await BrewDB.delete('test-app-meta')
  })

  const record = (): BackupRecord => ({
    lastBackupAt: '2026-07-07T00:00:00.000Z',
    method: 'fsa-folder',
    bytes: 4096,
    rowCounts: { recipes: 2 },
    schemaVersion: 1,
  })

  it('schema is at version 12 with a yeastLots store', async () => {
    expect(db.verno).toBe(12)
    expect(db.tables.map((t) => t.name)).toContain('appMeta')
  })

  it('sets and gets a BackupRecord (Zod on read + write)', async () => {
    await repo.setBackupRecord(record())
    expect(await repo.getBackupRecord()).toEqual(record())
  })

  it('returns null for a corrupt stored record', async () => {
    await db.appMeta.put({ key: 'backupRecord', value: { method: 'nonsense' } })
    expect(await repo.getBackupRecord()).toBeNull()
  })

  it('stores and retrieves the dir handle un-parsed (opaque)', async () => {
    const fake = { kind: 'directory', name: 'brew-backups' } as unknown as FileSystemDirectoryHandle
    await repo.setDirHandle(fake)
    expect(await repo.getDirHandle()).toEqual(fake)
  })

  it('clearBackupRecord empties the record but keeps the dir handle', async () => {
    const fake = { kind: 'directory', name: 'brew-backups' } as unknown as FileSystemDirectoryHandle
    await repo.setBackupRecord(record())
    await repo.setDirHandle(fake)
    await repo.clearBackupRecord()
    expect(await repo.getBackupRecord()).toBeNull()
    expect(await repo.getDirHandle()).toEqual(fake)
  })
})
