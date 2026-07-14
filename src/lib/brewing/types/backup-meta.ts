import { z } from 'zod'

export const BACKUP_META_SCHEMA_VERSION = 1 as const

/** In-FILE sidecar block embedded in every dump. Records BOTH version counters. */
export const BackupFileMetaSchema = z.object({
  dumpVersion: z.number().int(),
  dbVersion: z.number().int(),
  rowCounts: z.record(z.string(), z.number().int()),
  schemaVersion: z.literal(BACKUP_META_SCHEMA_VERSION),
})
export type BackupFileMeta = z.infer<typeof BackupFileMetaSchema>

/** STORED (appMeta KV) record for the last-backup-age UI. */
export const BackupRecordSchema = z.object({
  lastBackupAt: z.string(),
  method: z.enum(['fsa-folder', 'download']),
  bytes: z.number().int().nonnegative(),
  rowCounts: z.record(z.string(), z.number().int()),
  schemaVersion: z.literal(BACKUP_META_SCHEMA_VERSION),
})
export type BackupRecord = z.infer<typeof BackupRecordSchema>
