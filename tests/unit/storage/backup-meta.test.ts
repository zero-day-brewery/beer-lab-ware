import { describe, expect, it } from 'vitest'
import {
  BACKUP_META_SCHEMA_VERSION,
  BackupFileMetaSchema,
  BackupRecordSchema,
} from '@/lib/brewing/types/backup-meta'

describe('backup-meta schemas', () => {
  it('parses a valid BackupRecord', () => {
    const rec = {
      lastBackupAt: '2026-07-07T00:00:00.000Z',
      method: 'download' as const,
      bytes: 2048,
      rowCounts: { recipes: 3 },
      schemaVersion: 1 as const,
    }
    expect(BackupRecordSchema.parse(rec)).toEqual(rec)
  })

  it('rejects an unknown backup method (no opfs)', () => {
    expect(() =>
      BackupRecordSchema.parse({
        lastBackupAt: 'x',
        method: 'opfs',
        bytes: 1,
        rowCounts: {},
        schemaVersion: 1,
      }),
    ).toThrow()
  })

  it('rejects negative bytes', () => {
    expect(() =>
      BackupRecordSchema.parse({
        lastBackupAt: 'x',
        method: 'download',
        bytes: -1,
        rowCounts: {},
        schemaVersion: 1,
      }),
    ).toThrow()
  })

  it('parses a BackupFileMeta carrying both version counters', () => {
    const meta = {
      dumpVersion: 7,
      dbVersion: 8,
      rowCounts: { recipes: 1, readings: 4 },
      schemaVersion: BACKUP_META_SCHEMA_VERSION,
    }
    expect(BackupFileMetaSchema.parse(meta)).toEqual(meta)
  })
})
