/**
 * Device-local sync metadata (per-device id + last-sync time), stored in the
 * `appMeta` KV store. appMeta is DEVICE-LOCAL and deliberately EXCLUDED from
 * backups (see schema.ts) — so a device's identity/cursor never syncs to another
 * device, which is exactly right: each device must know what IT has synced.
 */

import { type BrewDB, db } from '@/lib/db/schema'

const DEVICE_ID_KEY = 'sync:deviceId'
const LAST_SYNC_KEY = 'sync:lastSyncAt'

export function makeSyncMetaRepo(database: BrewDB = db) {
  return {
    /** Get-or-create this device's stable id. */
    async deviceId(): Promise<string> {
      const row = await database.appMeta.get(DEVICE_ID_KEY)
      if (typeof row?.value === 'string') return row.value
      const id = crypto.randomUUID()
      await database.appMeta.put({ key: DEVICE_ID_KEY, value: id })
      return id
    },
    async lastSyncAt(): Promise<string | null> {
      const row = await database.appMeta.get(LAST_SYNC_KEY)
      return typeof row?.value === 'string' ? row.value : null
    },
    async setLastSyncAt(iso: string): Promise<void> {
      await database.appMeta.put({ key: LAST_SYNC_KEY, value: iso })
    },
  }
}

export const syncMetaRepo = makeSyncMetaRepo()
