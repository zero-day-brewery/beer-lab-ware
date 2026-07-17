/**
 * Secret-exclusion guard for the sync surface.
 *
 * The set of tables that sync (and therefore land in the canonical brewery.json
 * the daemon stores) is a FIXED allow-list. Secrets must never join it:
 *   - the AI-companion API key lives in localStorage `brew-companion` (a zustand
 *     persist store), NOT a Dexie table — so it's excluded from every dump.
 *   - the per-device sync token lives client-side in localStorage/appMeta, never a
 *     synced table (else it would self-propagate onto brewery.json + every device).
 *
 * This test freezes the allow-list: adding a table forces a conscious update here,
 * and any table whose name looks secret-shaped fails immediately.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { makeBackupService } from '@/lib/db/backup'
import { BrewDB } from '@/lib/db/schema'
import { emptyCollections } from '@/lib/node/brewery-store'
import { syncOnce } from '@/lib/sync/sync-client'
import { makeSyncMetaRepo } from '@/lib/sync/sync-meta'
import { InMemorySyncTransport } from '@/lib/sync/transport'

const EXPECTED_TABLES = [
  'recipes',
  'equipmentProfiles',
  'ingredients',
  'settings',
  'inventoryItems',
  'gearItems',
  'waterProfiles',
  'batches',
  'brewSessions',
  'brewTimers',
  'readings',
  'stockTransactions',
  'seedTombstones',
  'yeastLots',
  'rowTombstones',
].sort()

describe('sync surface secret-exclusion', () => {
  it('the synced table set is exactly the known allow-list', () => {
    expect(Object.keys(emptyCollections()).sort()).toEqual(EXPECTED_TABLES)
  })

  it('no synced table name is secret-shaped', () => {
    const secretish = /token|secret|apikey|api_key|password|credential|bearer|companion/i
    for (const name of Object.keys(emptyCollections())) {
      expect(name, `table "${name}" looks secret-bearing`).not.toMatch(secretish)
    }
  })
})

describe('sync connection config never enters a dump or a sync payload', () => {
  // Distinctive sentinels — a plain substring scan over the serialized output
  // is then a complete proof, no matter which table/field would have leaked.
  const TOKEN = 'tok-SECRET-df8a1b2c3d4e'
  const URL = 'https://sync-secret-host.example.test'

  const dbs: BrewDB[] = []
  afterEach(async () => {
    await Promise.all(dbs.splice(0).map((d) => d.delete().catch(() => {})))
  })
  function freshDb(): BrewDB {
    const d = new BrewDB(`secret-exclusion-${Date.now()}-${dbs.length}`)
    dbs.push(d)
    return d
  }

  it('a backup dump of a device WITH sync configured contains neither the token nor the URL', async () => {
    const database = freshDb()
    const repo = makeSyncMetaRepo(database)
    await repo.setServerUrl(URL)
    await repo.setToken(TOKEN)

    // The config IS stored (in device-local appMeta)…
    expect(await repo.token()).toBe(TOKEN)
    expect(await database.appMeta.get('sync:deviceToken')).toBeTruthy()

    // …but the dump (the exact bytes a backup writes AND the sync payload is
    // built from) excludes appMeta entirely.
    const dump = await makeBackupService(database).dump()
    const serialized = JSON.stringify(dump)
    expect(serialized).not.toContain(TOKEN)
    expect(serialized).not.toContain(URL)
    expect(Object.keys(dump.tables)).not.toContain('appMeta')
  })

  it('the payload syncOnce actually pushes to the transport contains neither the token nor the URL', async () => {
    const database = freshDb()
    const repo = makeSyncMetaRepo(database)
    await repo.setServerUrl(URL)
    await repo.setToken(TOKEN)

    const transport = new InMemorySyncTransport()
    await syncOnce({
      transport,
      backup: makeBackupService(database),
      snapshot: async () => {},
      now: '2026-07-01T00:00:00.000Z',
    })

    const canonical = await transport.pull()
    expect(canonical.payload).not.toBeNull()
    const wire = JSON.stringify(canonical.payload)
    expect(wire).not.toContain(TOKEN)
    expect(wire).not.toContain(URL)
  })
})
