import type { BackupRecord } from '@/lib/brewing/types/backup-meta'
import { BackupRecordSchema } from '@/lib/brewing/types/backup-meta'
import { type BrewDB, db } from '@/lib/db/schema'

const HANDLE_KEY = 'backupDirHandle'
const RECORD_KEY = 'backupRecord'

export function makeAppMetaRepo(database: BrewDB = db) {
  return {
    async getBackupRecord(): Promise<BackupRecord | null> {
      const row = await database.appMeta.get(RECORD_KEY)
      if (!row) return null
      const p = BackupRecordSchema.safeParse(row.value)
      return p.success ? p.data : null // corrupt → treat as "no backup"
    },
    async setBackupRecord(r: BackupRecord): Promise<void> {
      await database.appMeta.put({ key: RECORD_KEY, value: BackupRecordSchema.parse(r) })
    },
    async clearBackupRecord(): Promise<void> {
      await database.appMeta.delete(RECORD_KEY)
    },
    async getDirHandle(): Promise<FileSystemDirectoryHandle | null> {
      const row = await database.appMeta.get(HANDLE_KEY)
      return (row?.value as FileSystemDirectoryHandle | undefined) ?? null // NOT Zod-parsed (opaque)
    },
    async setDirHandle(h: FileSystemDirectoryHandle): Promise<void> {
      await database.appMeta.put({ key: HANDLE_KEY, value: h })
    },
    async clearDirHandle(): Promise<void> {
      await database.appMeta.delete(HANDLE_KEY)
    },
  }
}
export const appMetaRepo = makeAppMetaRepo()
