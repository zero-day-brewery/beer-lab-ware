/**
 * Node brewery-store — DumpV8 migration + ledger-invariant guard.
 *
 * Covers the Track B back-end requirements: the file store round-trips a real
 * client DumpV8 (incl. the new `yeastLots` + `seedTombstones` tables + `meta`),
 * still reads older v1..v6 dumps (newer tables → empty), and the exported
 * `assertLedgerInvariant` rejects a dump whose cached `amount` diverges from its
 * ledger (`amount === Σ deltas`).
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import {
  assertLedgerInvariant,
  CURRENT_DUMP_VERSION,
  emptyCollections,
  loadBrewery,
  parseEnvelope,
  saveBrewery,
} from '@/lib/node/brewery-store'
import { fixtureCollections } from '../../fixtures/node/brewery-fixture'

async function tmpFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brewery-store-'))
  return join(dir, 'brewery.json')
}

const yeastLot: YeastLot = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'US-05 Fermentis',
  strain: 'California Ale',
  form: 'dry',
  productionDate: '2026-05-01T00:00:00.000Z',
  initialCells_B: 200,
  generation: 0,
  quantity: 2,
  unit: 'packet',
  notes_md: '',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  schemaVersion: 1,
}

describe('brewery-store DumpV8', () => {
  it('writes the current v8 envelope with a meta sidecar', async () => {
    const file = await tmpFile()
    await saveBrewery(file, emptyCollections(), '2026-07-09T00:00:00.000Z')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    expect(raw.version).toBe(CURRENT_DUMP_VERSION)
    expect(raw.version).toBe(8)
    expect(raw.meta).toMatchObject({ dumpVersion: 8, schemaVersion: 1 })
    expect(raw.tables.yeastLots).toEqual([])
    expect(raw.tables.seedTombstones).toEqual([])
  })

  it('round-trips a client DumpV8 including yeastLots + seedTombstones', async () => {
    const file = await tmpFile()
    const c = fixtureCollections()
    c.seedTombstones = [{ id: 'seed-recipe-1' }]
    c.yeastLots = [yeastLot]
    await saveBrewery(file, c)
    const back = await loadBrewery(file)
    expect(back.seedTombstones).toEqual([{ id: 'seed-recipe-1' }])
    expect(back.yeastLots).toHaveLength(1)
    expect(back.yeastLots[0].strain).toBe('California Ale')
    expect(back.recipes).toHaveLength(c.recipes.length)
  })

  it('still reads an older v6 dump (new tables default empty)', async () => {
    const file = await tmpFile()
    await writeFile(
      file,
      JSON.stringify({ version: 6, exportedAt: '2026-06-01T00:00:00.000Z', tables: {} }),
      'utf8',
    )
    const c = await loadBrewery(file)
    expect(c.yeastLots).toEqual([])
    expect(c.seedTombstones).toEqual([])
    expect(c.recipes).toEqual([])
  })

  it('rejects an unsupported (too-new) version', () => {
    expect(() => parseEnvelope({ version: 9, tables: {} })).toThrow(/Unsupported/)
  })

  it('validates a malformed v8 meta sidecar', () => {
    expect(() => parseEnvelope({ version: 8, meta: { dumpVersion: 'nope' }, tables: {} })).toThrow()
  })

  describe('assertLedgerInvariant', () => {
    it('passes on a ledger-consistent dump (amount === Σ deltas)', () => {
      expect(() => assertLedgerInvariant(fixtureCollections())).not.toThrow()
    })

    it('throws when the cached amount diverges from the ledger', () => {
      const bad = fixtureCollections()
      bad.inventoryItems[0] = { ...bad.inventoryItems[0], amount: 999 }
      expect(() => assertLedgerInvariant(bad)).toThrow(/Ledger invariant violated/)
    })

    it('tolerates floating-point drift within epsilon', () => {
      const c = fixtureCollections()
      c.inventoryItems[0] = { ...c.inventoryItems[0], amount: 50 + 1e-9 }
      expect(() => assertLedgerInvariant(c)).not.toThrow()
    })
  })
})
