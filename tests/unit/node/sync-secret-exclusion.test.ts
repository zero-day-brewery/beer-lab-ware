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

import { describe, expect, it } from 'vitest'
import { emptyCollections } from '@/lib/node/brewery-store'

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
