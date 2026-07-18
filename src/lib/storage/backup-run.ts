import type { BackupRecord } from '@/lib/brewing/types/backup-meta'
import { backupService, type DumpV10 } from '@/lib/db/backup'
import { appMetaRepo } from '@/lib/db/repos/app-meta'
import { captureLocalSnapshot, type LocalStateSnapshot } from '@/lib/storage/local-state'
import { type AppVersion, getAppVersion } from '@/lib/version'

export const STALE_DAYS = 7
export const KEEP_LAST = 10

export class NeedsGestureError extends Error {}

export type BackupMethod = 'fsa-folder' | 'download'
export type ComposedBackup = DumpV10 & { app: AppVersion; local: LocalStateSnapshot }

const MS_PER_DAY = 86_400_000

export function supportsFolderBackup(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function configureFolder(): Promise<void> {
  const picker = (
    window as unknown as {
      showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker
  const handle = await picker({ id: 'brew-backups', mode: 'readwrite', startIn: 'documents' })
  await appMetaRepo.setDirHandle(handle)
}

export async function buildComposedBackup(): Promise<ComposedBackup> {
  const dump = await backupService.dump()
  return { ...dump, app: getAppVersion(), local: captureLocalSnapshot() }
}

function backupFilename(now = new Date()): string {
  return `beer-lab-ware-backup-${now.toISOString().slice(0, 10)}.json`
}

async function writeToFolder(file: ComposedBackup, filename: string): Promise<{ bytes: number }> {
  const handle = await appMetaRepo.getDirHandle()
  if (handle === null) throw new NeedsGestureError('No backup folder configured')
  const perm = await (
    handle as unknown as { queryPermission: (o: object) => Promise<PermissionState> }
  ).queryPermission({ mode: 'readwrite' })
  if (perm !== 'granted') throw new NeedsGestureError('Folder permission not granted')
  const body = JSON.stringify(file, null, 2)
  const bytes = new Blob([body]).size
  try {
    const fileHandle = await handle.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(body)
    await writable.close()
  } catch (err) {
    // The folder was moved/deleted while its handle lived on in IndexedDB (origin
    // data survived but the picked directory is gone → NotFoundError). Drop the
    // dead handle so the card reverts to unconfigured and re-prompts the user to
    // reconnect — never silently stop (spec E1.5 "missing/invalid handle" + E1.11).
    await appMetaRepo.clearDirHandle()
    throw new NeedsGestureError(`Backup folder is no longer available: ${(err as Error).message}`)
  }
  return { bytes }
}

function triggerDownload(file: ComposedBackup, filename: string): { bytes: number } {
  const body = JSON.stringify(file, null, 2)
  const blob = new Blob([body], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return { bytes: blob.size }
}

async function pruneFolder(keepLast: number): Promise<void> {
  const handle = await appMetaRepo.getDirHandle()
  if (handle === null) return
  const names: string[] = []
  for await (const [name, entry] of handle as unknown as AsyncIterable<
    [string, { kind: string }]
  >) {
    if (entry.kind === 'file' && /^beer-lab-ware-backup-.*\.json$/.test(name)) names.push(name)
  }
  names.sort() // ISO-date filenames sort chronologically
  for (const name of names.slice(0, Math.max(0, names.length - keepLast))) {
    await (handle as unknown as { removeEntry: (n: string) => Promise<void> }).removeEntry(name)
  }
}

/**
 * The ONE entry point. folder supported + configured + permission 'granted' →
 * writeToFolder (silent) + pruneFolder; else → triggerDownload. On a
 * NeedsGestureError the prior BackupRecord is NOT overwritten (throw propagates
 * before setBackupRecord).
 */
export async function runBackup(): Promise<BackupRecord> {
  const file = await buildComposedBackup()
  const filename = backupFilename()
  const handle = await appMetaRepo.getDirHandle()
  let method: BackupMethod
  let bytes: number
  if (supportsFolderBackup() && handle !== null) {
    ;({ bytes } = await writeToFolder(file, filename)) // may throw NeedsGestureError
    method = 'fsa-folder'
    // Pruning is best-effort cleanup: the backup is already durably written, so
    // a failed removeEntry (locked/permission) must NOT block setBackupRecord —
    // otherwise the age chip stays stale forever and the rejection escapes
    // uncaught on the manual path (only NeedsGestureError is handled upstream).
    try {
      await pruneFolder(KEEP_LAST)
    } catch (err) {
      console.warn('backup prune failed (non-fatal):', err)
    }
  } else {
    ;({ bytes } = triggerDownload(file, filename))
    method = 'download'
  }
  const record: BackupRecord = {
    lastBackupAt: new Date().toISOString(),
    method,
    bytes,
    rowCounts: file.meta.rowCounts,
    schemaVersion: 1,
  }
  await appMetaRepo.setBackupRecord(record)
  return record
}

/**
 * Launch-time staleness check. PURELY TIME-BASED — no content dirty-check.
 * no record OR age > STALE_DAYS: folder granted → runBackup() → 'backed-up';
 * else → 'nudge'. fresh → 'noop'.
 */
export async function maybeBackupOnLaunch(): Promise<'backed-up' | 'nudge' | 'noop'> {
  const record = await appMetaRepo.getBackupRecord()
  const ageDays =
    record === null
      ? Number.POSITIVE_INFINITY
      : (Date.now() - Date.parse(record.lastBackupAt)) / MS_PER_DAY
  if (ageDays <= STALE_DAYS) return 'noop'
  const handle = await appMetaRepo.getDirHandle()
  if (supportsFolderBackup() && handle !== null) {
    try {
      await runBackup()
      return 'backed-up'
    } catch (err) {
      if (err instanceof NeedsGestureError) return 'nudge'
      throw err
    }
  }
  return 'nudge'
}
