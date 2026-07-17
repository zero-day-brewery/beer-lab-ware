/**
 * Device-local sync metadata + connection config, stored in the `appMeta` KV
 * store. appMeta is DEVICE-LOCAL and deliberately EXCLUDED from backups (see
 * schema.ts + `backupService.dump()`'s fixed table list) — so:
 *   - a device's identity/cursor never syncs to another device (each device
 *     must know what IT has synced), and
 *   - the sync server URL and the per-device Bearer TOKEN never enter a backup
 *     dump or a sync payload. The token self-propagating onto brewery.json —
 *     and from there onto every other device — would defeat per-device
 *     revocation entirely. Frozen by
 *     `tests/unit/node/sync-secret-exclusion.test.ts`.
 *
 * Survives "Wipe ALL data" by design (same as the backup-folder handle): the
 * connection config is a device preference, not brewery data — wiping the
 * brewery shouldn't disconnect the device.
 */

import { type BrewDB, db } from '@/lib/db/schema'
import type { SyncMode } from '@/lib/sync/sync-client'

const DEVICE_ID_KEY = 'sync:deviceId'
const LAST_SYNC_KEY = 'sync:lastSyncAt'
const SERVER_URL_KEY = 'sync:serverUrl'
const TOKEN_KEY = 'sync:deviceToken'
const MODE_KEY = 'sync:mode'
const LAST_OUTCOME_KEY = 'sync:lastOutcome'

const SYNC_MODES: readonly SyncMode[] = ['two-way', 'pull-only', 'push-only']

/** Result of the most recent sync ATTEMPT (success or failure), for the
 *  diagnostics page. `message` is the human summary already shown in the
 *  toast — never token material. */
export interface SyncOutcome {
  at: string
  mode: SyncMode
  ok: boolean
  message: string
}

function isSyncOutcome(v: unknown): v is SyncOutcome {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.at === 'string' &&
    typeof o.ok === 'boolean' &&
    typeof o.message === 'string' &&
    SYNC_MODES.includes(o.mode as SyncMode)
  )
}

export function makeSyncMetaRepo(database: BrewDB = db) {
  async function getString(key: string): Promise<string | null> {
    const row = await database.appMeta.get(key)
    return typeof row?.value === 'string' ? row.value : null
  }
  async function putOrDelete(key: string, value: string): Promise<void> {
    if (value === '') await database.appMeta.delete(key)
    else await database.appMeta.put({ key, value })
  }

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

    /** Sync server base URL (already-validated form). `null` when unset. */
    serverUrl: () => getString(SERVER_URL_KEY),
    /** Set/clear (empty string clears) the sync server base URL. */
    setServerUrl: (url: string) => putOrDelete(SERVER_URL_KEY, url.trim()),

    /** Per-device Bearer token. `null` when unset. DEVICE-LOCAL ONLY — see
     *  module doc; never enters dumps or sync payloads. */
    token: () => getString(TOKEN_KEY),
    /** Set/clear (empty string clears) the per-device Bearer token. */
    setToken: (token: string) => putOrDelete(TOKEN_KEY, token.trim()),

    /** Selected sync direction — defaults to 'two-way' when unset/corrupt. */
    async mode(): Promise<SyncMode> {
      const v = await getString(MODE_KEY)
      return SYNC_MODES.includes(v as SyncMode) ? (v as SyncMode) : 'two-way'
    },
    async setMode(mode: SyncMode): Promise<void> {
      await database.appMeta.put({ key: MODE_KEY, value: mode })
    },

    /** Most recent sync attempt (success OR failure); `null` when never tried
     *  or the stored record is corrupt (treated as "no record"). */
    async lastOutcome(): Promise<SyncOutcome | null> {
      const row = await database.appMeta.get(LAST_OUTCOME_KEY)
      return isSyncOutcome(row?.value) ? row.value : null
    },
    async setLastOutcome(outcome: SyncOutcome): Promise<void> {
      await database.appMeta.put({ key: LAST_OUTCOME_KEY, value: outcome })
    },
  }
}

export const syncMetaRepo = makeSyncMetaRepo()
