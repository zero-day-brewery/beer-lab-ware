'use client'
import { liveQuery } from 'dexie'
import { useCallback, useEffect, useState } from 'react'
import type { BackupRecord } from '@/lib/brewing/types/backup-meta'
import { appMetaRepo } from '@/lib/db/repos/app-meta'
import { reportDbError } from '@/lib/diagnostics/error-log'
import type { BackupMethod } from '@/lib/storage/backup-run'
import {
  configureFolder as configureFolderImpl,
  NeedsGestureError,
  runBackup as runBackupImpl,
} from '@/lib/storage/backup-run'

export type Freshness = 'fresh' | 'stale' | 'critical'

export interface BackupStatus {
  lastBackupAt: string | null
  ageDays: number | null
  freshness: Freshness
  method: BackupMethod | null
}

const MS_PER_DAY = 86_400_000

/** PURE. null → critical/"No backup yet"; <7d fresh; 7–30d stale; >30d critical. */
export function deriveBackupStatus(record: BackupRecord | null, now = Date.now()): BackupStatus {
  if (record === null) {
    return { lastBackupAt: null, ageDays: null, freshness: 'critical', method: null }
  }
  const ageDays = (now - Date.parse(record.lastBackupAt)) / MS_PER_DAY
  const freshness: Freshness = ageDays < 7 ? 'fresh' : ageDays <= 30 ? 'stale' : 'critical'
  return { lastBackupAt: record.lastBackupAt, ageDays, freshness, method: record.method }
}

export interface UseBackupStatus extends BackupStatus {
  configured: boolean
  needsGesture: boolean
  runBackup: () => Promise<void>
  configureFolder: () => Promise<void>
}

export function useBackupStatus(): UseBackupStatus {
  const [record, setRecord] = useState<BackupRecord | null>(null)
  const [configured, setConfigured] = useState(false)
  const [needsGesture, setNeedsGesture] = useState(false)

  useEffect(() => {
    const sub = liveQuery(() => appMetaRepo.getBackupRecord()).subscribe({
      next: (r) => setRecord(r),
      error: (e) => reportDbError('backup-record', e),
    })
    void appMetaRepo.getDirHandle().then((h) => setConfigured(h !== null))
    return () => sub.unsubscribe()
  }, [])

  const runBackup = useCallback(async () => {
    try {
      await runBackupImpl()
      setNeedsGesture(false)
    } catch (err) {
      if (err instanceof NeedsGestureError) setNeedsGesture(true)
      else throw err
    }
  }, [])

  const configureFolder = useCallback(async () => {
    await configureFolderImpl()
    setConfigured(true)
    setNeedsGesture(false)
  }, [])

  return { ...deriveBackupStatus(record), configured, needsGesture, runBackup, configureFolder }
}
