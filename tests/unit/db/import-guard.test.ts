import { describe, expect, it } from 'vitest'
import { DUMP_VERSION } from '@/lib/db/backup'
import { parseAndGuardDump } from '@/lib/db/import-guard'

function v7dump() {
  return {
    version: 7,
    exportedAt: new Date().toISOString(),
    meta: { dumpVersion: 7, dbVersion: 8, rowCounts: {}, schemaVersion: 1 },
    tables: {
      recipes: [{ id: 'r1' }, { id: 'r2' }],
      equipmentProfiles: [],
      ingredients: [],
      settings: [],
      inventoryItems: [],
      gearItems: [],
      waterProfiles: [],
      batches: [{ id: 'b1' }],
      brewSessions: [],
      brewTimers: [],
      readings: [],
      stockTransactions: [],
      seedTombstones: [],
    },
  }
}

describe('parseAndGuardDump', () => {
  it('rejects non-JSON text', () => {
    const r = parseAndGuardDump('{ not json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-json')
  })

  it('rejects a JSON value with no numeric version (malformed)', () => {
    const r = parseAndGuardDump(JSON.stringify({ tables: {} }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('malformed')
  })

  it('rejects a future dump version (too-new) — the key guard', () => {
    const future = { ...v7dump(), version: DUMP_VERSION + 1 }
    const r = parseAndGuardDump(JSON.stringify(future))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('too-new')
      expect(r.message).toContain(String(DUMP_VERSION + 1))
    }
  })

  it('rejects an out-of-range / non-integer version (unrecognized)', () => {
    const r = parseAndGuardDump(JSON.stringify({ ...v7dump(), version: 0 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unrecognized')
  })

  it('accepts a v7 dump and returns per-table summary counts', () => {
    const r = parseAndGuardDump(JSON.stringify(v7dump()))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.dump.version).toBe(7)
      expect(r.summary.recipes).toBe(2)
      expect(r.summary.batches).toBe(1)
      expect(r.summary.readings).toBe(0)
    }
  })
})
