import { describe, expect, it } from 'vitest'
import { mergeDumpTables } from '@/lib/sync/sync-client'

// mergeDumpTables operates on raw Tables (no Zod), so minimal batch rows suffice —
// the resolver reads id/status/fermenterBoardId/batchNo only.
// biome-ignore lint/suspicious/noExplicitAny: raw Tables fixtures
function tables(over: Record<string, unknown> = {}): any {
  return {
    recipes: [],
    equipmentProfiles: [],
    ingredients: [],
    settings: [],
    inventoryItems: [],
    gearItems: [],
    waterProfiles: [],
    batches: [],
    brewSessions: [],
    brewTimers: [],
    readings: [],
    stockTransactions: [],
    seedTombstones: [],
    yeastLots: [],
    rowTombstones: [],
    deviceLinks: [],
    ...over,
  }
}
const ip = (id: string, batchNo: number, board = 'f1') => ({
  id,
  batchNo,
  status: 'in-progress',
  fermenterBoardId: board,
  logs: [],
  updatedAt: '2026-07-01T00:00:00.000Z',
})
const NOW = '2026-07-24T00:00:00.000Z'

const ip2 = (b: { status: string }) => b.status === 'in-progress'
const arch = (b: { status: string }) => b.status === 'archived'

describe('mergeDumpTables — board-conflict resolution', () => {
  it('archives the loser + reports boardConflictsResolved when two devices minted on one vessel', () => {
    // Device-local mint (aaaa) meets a remote mint (bbbb) on the same board.
    const out = mergeDumpTables(
      tables({ batches: [ip('aaaa', 1)] }),
      tables({ batches: [ip('bbbb', 2)] }),
      NOW,
    )
    const rows = out.tables.batches
    expect(rows).toHaveLength(2) // union — nothing deleted
    expect(rows.filter(ip2)).toHaveLength(1)
    expect(rows.filter(arch)).toHaveLength(1)
    // Higher batchNo (later mint) is the deterministic winner (immutable ranking).
    expect(rows.find(ip2)?.id).toBe('bbbb')
    expect(out.boardConflictsResolved).toBe(1) // telemetry surfaced
  })

  it('both devices compute the SAME winner (local/remote swapped)', () => {
    const a = mergeDumpTables(
      tables({ batches: [ip('aaaa', 1)] }),
      tables({ batches: [ip('bbbb', 2)] }),
      NOW,
    )
    const b = mergeDumpTables(
      tables({ batches: [ip('bbbb', 2)] }),
      tables({ batches: [ip('aaaa', 1)] }),
      NOW,
    )
    expect(a.tables.batches.find(ip2)?.id).toBe('bbbb')
    expect(b.tables.batches.find(ip2)?.id).toBe('bbbb') // no divergence regardless of which side is "local"
  })

  it('leaves a single in-progress batch per vessel untouched (0 resolved)', () => {
    const out = mergeDumpTables(tables({ batches: [ip('aaaa', 1)] }), tables(), NOW)
    expect(out.tables.batches.filter(ip2)).toHaveLength(1)
    expect(out.tables.batches.filter(arch)).toHaveLength(0)
    expect(out.boardConflictsResolved).toBe(0)
  })

  it('does not conflate two vessels', () => {
    const out = mergeDumpTables(
      tables({ batches: [ip('a1', 1, 'f1'), ip('a2', 2, 'f2')] }),
      tables(),
      NOW,
    )
    expect(out.tables.batches.filter(ip2)).toHaveLength(2)
    expect(out.boardConflictsResolved).toBe(0)
  })
})
