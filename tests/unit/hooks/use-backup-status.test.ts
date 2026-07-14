import { describe, expect, it } from 'vitest'
import { deriveBackupStatus } from '@/hooks/use-backup-status'
import type { BackupRecord } from '@/lib/brewing/types/backup-meta'

const NOW = Date.parse('2026-07-07T00:00:00.000Z')
const rec = (daysAgo: number): BackupRecord => ({
  lastBackupAt: new Date(NOW - daysAgo * 86_400_000).toISOString(),
  method: 'download',
  bytes: 10,
  rowCounts: {},
  schemaVersion: 1,
})

describe('deriveBackupStatus', () => {
  it('null record → critical, ageDays null (No backup yet)', () => {
    const s = deriveBackupStatus(null, NOW)
    expect(s.freshness).toBe('critical')
    expect(s.ageDays).toBeNull()
    expect(s.lastBackupAt).toBeNull()
    expect(s.method).toBeNull()
  })
  it('under 7 days → fresh', () => {
    expect(deriveBackupStatus(rec(3), NOW).freshness).toBe('fresh')
  })
  it('7 to 30 days → stale', () => {
    expect(deriveBackupStatus(rec(10), NOW).freshness).toBe('stale')
  })
  it('over 30 days → critical', () => {
    expect(deriveBackupStatus(rec(45), NOW).freshness).toBe('critical')
  })
})
