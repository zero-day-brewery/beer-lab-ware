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

describe('mergeDumpTables — board-conflict resolution', () => {
  it('archives the loser when two devices minted an in-progress batch on the same vessel', () => {
    // Device-local mint (aaaa) meets a remote mint (bbbb) on the same board.
    const out = mergeDumpTables(
      tables({ batches: [ip('aaaa', 1)] }),
      tables({ batches: [ip('bbbb', 2)] }),
      NOW,
    )
    expect(out.batches).toHaveLength(2) // union — nothing deleted
    expect(out.batches.filter((b: { status: string }) => b.status === 'in-progress')).toHaveLength(
      1,
    )
    expect(out.batches.filter((b: { status: string }) => b.status === 'archived')).toHaveLength(1)
    // Higher batchNo (later mint) is the deterministic winner (immutable ranking).
    expect(out.batches.find((b: { status: string }) => b.status === 'in-progress')?.id).toBe('bbbb')
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
    const winnerA = a.batches.find((x: { status: string }) => x.status === 'in-progress')?.id
    const winnerB = b.batches.find((x: { status: string }) => x.status === 'in-progress')?.id
    expect(winnerA).toBe('bbbb')
    expect(winnerB).toBe('bbbb') // no divergence regardless of which side is "local"
  })

  it('leaves a single in-progress batch per vessel untouched', () => {
    const out = mergeDumpTables(tables({ batches: [ip('aaaa', 1)] }), tables(), NOW)
    expect(out.batches.filter((b: { status: string }) => b.status === 'in-progress')).toHaveLength(
      1,
    )
    expect(out.batches.filter((b: { status: string }) => b.status === 'archived')).toHaveLength(0)
  })

  it('does not conflate two vessels', () => {
    const out = mergeDumpTables(
      tables({ batches: [ip('a1', 1, 'f1'), ip('a2', 2, 'f2')] }),
      tables(),
      NOW,
    )
    expect(out.batches.filter((b: { status: string }) => b.status === 'in-progress')).toHaveLength(
      2,
    )
  })
})
