/**
 * Node brewery-store — DumpV10 migration + ledger-invariant guard + PUT
 * generation rotation.
 *
 * Covers the Track B back-end requirements: the file store round-trips a real
 * client DumpV10 (incl. the `yeastLots` + `seedTombstones` + `rowTombstones` +
 * `deviceLinks` tables + `meta`), still reads older v1..v6 dumps (newer tables
 * → empty), the exported `assertLedgerInvariant` rejects a dump whose cached
 * `amount` diverges from its ledger (`amount === Σ deltas`), and
 * `rotateGenerations` snapshots + prunes the `.bak` history the sync daemon
 * keeps before each PUT overwrite.
 */

import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DeviceLink } from '@/lib/brewing/types/device-link'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'
import {
  assertLedgerInvariant,
  CURRENT_DUMP_VERSION,
  emptyCollections,
  loadBrewery,
  parseEnvelope,
  rotateGenerations,
  SUPPORTED_VERSIONS,
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

const deviceLink: DeviceLink = {
  id: '44444444-4444-4444-8444-444444444444',
  deviceKey: 'tilt:RED',
  batchId: '77777777-7777-4777-8777-777777777777',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  schemaVersion: 1,
}

describe('brewery-store DumpV10', () => {
  it('writes the current v10 envelope with a meta sidecar', async () => {
    const file = await tmpFile()
    await saveBrewery(file, emptyCollections(), '2026-07-09T00:00:00.000Z')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    expect(raw.version).toBe(CURRENT_DUMP_VERSION)
    expect(raw.version).toBe(10)
    expect(raw.meta).toMatchObject({ dumpVersion: 10, schemaVersion: 1 })
    expect(raw.tables.yeastLots).toEqual([])
    expect(raw.tables.seedTombstones).toEqual([])
    expect(raw.tables.rowTombstones).toEqual([])
    expect(raw.tables.deviceLinks).toEqual([])
  })

  it('round-trips a client DumpV10 including yeastLots + seedTombstones + rowTombstones + deviceLinks', async () => {
    const file = await tmpFile()
    const c = fixtureCollections()
    c.seedTombstones = [{ id: 'seed-recipe-1' }]
    c.yeastLots = [yeastLot]
    c.rowTombstones = [
      { id: 'deleted-recipe-1', table: 'recipes', deletedAt: '2026-06-01T00:00:00.000Z' },
    ]
    c.deviceLinks = [deviceLink]
    await saveBrewery(file, c)
    const back = await loadBrewery(file)
    expect(back.seedTombstones).toEqual([{ id: 'seed-recipe-1' }])
    expect(back.yeastLots).toHaveLength(1)
    expect(back.yeastLots[0].strain).toBe('California Ale')
    expect(back.rowTombstones).toEqual([
      { id: 'deleted-recipe-1', table: 'recipes', deletedAt: '2026-06-01T00:00:00.000Z' },
    ])
    expect(back.deviceLinks).toEqual([deviceLink])
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
    expect(c.rowTombstones).toEqual([])
    expect(c.deviceLinks).toEqual([])
    expect(c.recipes).toEqual([])
  })

  it('still reads a v9 dump that predates deviceLinks (defaults to empty)', async () => {
    const file = await tmpFile()
    const c = fixtureCollections()
    await writeFile(
      file,
      JSON.stringify({
        version: 9,
        exportedAt: '2026-07-01T00:00:00.000Z',
        meta: { dumpVersion: 9, dbVersion: 9, rowCounts: {}, schemaVersion: 1 },
        tables: c,
      }),
      'utf8',
    )
    const back = await loadBrewery(file)
    expect(back.deviceLinks).toEqual([])
    expect(back.recipes).toHaveLength(c.recipes.length)
  })

  it('rejects an unsupported (too-new) version', () => {
    expect(() => parseEnvelope({ version: 11, tables: {} })).toThrow(/Unsupported/)
  })

  it('exports SUPPORTED_VERSIONS matching the versions parseEnvelope accepts', () => {
    expect(SUPPORTED_VERSIONS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    for (const v of SUPPORTED_VERSIONS) {
      expect(() => parseEnvelope({ version: v, tables: {} })).not.toThrow()
    }
  })

  it('validates a malformed v8 meta sidecar', () => {
    expect(() => parseEnvelope({ version: 8, meta: { dumpVersion: 'nope' }, tables: {} })).toThrow()
  })

  // Adversarial-review hardening: a corrupt `deletedAt` must be REJECTED at
  // the Zod boundary, not silently accepted (fails open — never suppresses,
  // never GCs, see sync/merge.ts + sync-client.ts).
  it('rejects a rowTombstone whose deletedAt does not parse to a finite timestamp', () => {
    expect(() =>
      parseEnvelope({
        version: 9,
        tables: { rowTombstones: [{ id: 'x', table: 'recipes', deletedAt: 'not-a-date' }] },
      }),
    ).toThrow()
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

  describe('rotateGenerations', () => {
    async function backupsIn(dir: string): Promise<string[]> {
      return (await readdir(dir)).filter((n) => n.endsWith('.bak')).sort()
    }

    it('is a no-op when the file does not exist yet (first-ever write)', async () => {
      const file = await tmpFile()
      await expect(rotateGenerations(file, 10)).resolves.toBeUndefined()
      expect(await backupsIn(dirname(file))).toEqual([])
    })

    it('is a no-op when keep <= 0, even with an existing file', async () => {
      const file = await tmpFile()
      await writeFile(file, 'v1', 'utf8')
      await rotateGenerations(file, 0)
      expect(await backupsIn(dirname(file))).toEqual([])
    })

    it('copies the CURRENT file to a filename-safe ISO-timestamped .bak', async () => {
      const file = await tmpFile()
      await writeFile(file, 'v1', 'utf8')
      const now = () => new Date('2026-07-16T10:15:00.000Z')
      await rotateGenerations(file, 10, now)

      const backups = await backupsIn(dirname(file))
      expect(backups).toEqual(['brewery.json.2026-07-16T101500Z.bak'])
      expect(await readFile(join(dirname(file), backups[0]), 'utf8')).toBe('v1')
    })

    it('appends a counter suffix instead of clobbering when two rotations land in the same second', async () => {
      const file = await tmpFile()
      const now = () => new Date('2026-07-16T10:15:00.000Z') // fixed clock — forces a collision
      await writeFile(file, 'v1', 'utf8')
      await rotateGenerations(file, 10, now)
      await writeFile(file, 'v2', 'utf8')
      await rotateGenerations(file, 10, now)

      const dir = dirname(file)
      expect(await backupsIn(dir)).toEqual([
        'brewery.json.2026-07-16T101500Z-1.bak',
        'brewery.json.2026-07-16T101500Z.bak',
      ])
      expect(await readFile(join(dir, 'brewery.json.2026-07-16T101500Z.bak'), 'utf8')).toBe('v1')
      expect(await readFile(join(dir, 'brewery.json.2026-07-16T101500Z-1.bak'), 'utf8')).toBe('v2')
    })

    it('prunes the oldest-by-mtime backups so at most `keep` remain', async () => {
      const file = await tmpFile()
      await writeFile(file, 'v0', 'utf8') // seed the first canonical version
      const baseMs = Date.parse('2026-07-16T10:00:00.000Z')
      let tick = 0
      const now = () => new Date(baseMs + tick++ * 1000) // distinct, increasing stamps

      for (let k = 1; k <= 4; k++) {
        await rotateGenerations(file, 2, now) // snapshot the version about to be replaced
        await writeFile(file, `v${k}`, 'utf8')
      }

      expect(await backupsIn(dirname(file))).toHaveLength(2)
    })

    it('does not touch the atomic write path — saveBrewery still round-trips after rotation', async () => {
      const file = await tmpFile()
      await saveBrewery(file, fixtureCollections(), '2026-01-01T00:00:00.000Z')
      await rotateGenerations(file, 5)
      await saveBrewery(file, fixtureCollections(), '2026-01-02T00:00:00.000Z')

      const back = await loadBrewery(file)
      expect(back.recipes).toHaveLength(fixtureCollections().recipes.length)
      expect(await backupsIn(dirname(file))).toHaveLength(1)
    })
  })
})
