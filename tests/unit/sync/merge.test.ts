import { describe, expect, it } from 'vitest'

import { mergeLedger, mergeState, mergeTombstones, type RowTombstone } from '@/lib/sync/merge'

type Row = { id: string; updatedAt?: string; at?: string; v: number }

function tombstone(over: Partial<RowTombstone> & Pick<RowTombstone, 'id' | 'table'>): RowTombstone {
  return { deletedAt: '2026-06-01T00:00:00.000Z', ...over }
}

describe('mergeState (last-write-wins by timestamp, union by id)', () => {
  it('keeps the newer row for a shared id', () => {
    const local: Row[] = [{ id: 'a', updatedAt: '2026-06-01T00:00:00.000Z', v: 1 }]
    const remote: Row[] = [{ id: 'a', updatedAt: '2026-06-02T00:00:00.000Z', v: 2 }]
    expect(mergeState(local, remote)).toEqual([
      { id: 'a', updatedAt: '2026-06-02T00:00:00.000Z', v: 2 },
    ])
  })

  it('unions rows unique to each side', () => {
    const local: Row[] = [{ id: 'a', updatedAt: '2026-06-01T00:00:00.000Z', v: 1 }]
    const remote: Row[] = [{ id: 'b', updatedAt: '2026-06-01T00:00:00.000Z', v: 9 }]
    const out = mergeState(local, remote).sort((x, y) => x.id.localeCompare(y.id))
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('prefers local on an exact timestamp tie (deterministic)', () => {
    const t = '2026-06-01T00:00:00.000Z'
    const local: Row[] = [{ id: 'a', updatedAt: t, v: 1 }]
    const remote: Row[] = [{ id: 'a', updatedAt: t, v: 2 }]
    expect(mergeState(local, remote)[0].v).toBe(1)
  })

  it('falls back to `at` then treats missing timestamps as oldest (local wins)', () => {
    const local: Row[] = [{ id: 'a', at: '2026-06-05T00:00:00.000Z', v: 1 }]
    const remote: Row[] = [{ id: 'a', v: 2 }] // no timestamp → oldest
    expect(mergeState(local, remote)[0].v).toBe(1)
  })
})

describe('mergeLedger (append-only union, dedupe by id, sorted by at)', () => {
  it('unions immutable events and dedupes by id', () => {
    const local = [
      { id: 't1', at: '2026-06-01T00:00:00.000Z' },
      { id: 't2', at: '2026-06-03T00:00:00.000Z' },
    ]
    const remote = [
      { id: 't2', at: '2026-06-03T00:00:00.000Z' }, // dup id
      { id: 't3', at: '2026-06-02T00:00:00.000Z' },
    ]
    const out = mergeLedger(local, remote)
    expect(out.map((t) => t.id)).toEqual(['t1', 't3', 't2']) // union, sorted by at
  })
})

describe('mergeState — tombstone suppression (3rd param)', () => {
  it('suppresses a row present on only one side when its timestamp is at-or-before the tombstone', () => {
    // Device A deleted row "a" (tombstone deletedAt=06-05); device B never
    // learned about the delete and still has its old copy (updatedAt=06-01,
    // strictly before the delete) — the classic resurrection setup.
    const local: Row[] = [] // A: already deleted, no row
    const remote: Row[] = [{ id: 'a', updatedAt: '2026-06-01T00:00:00.000Z', v: 1 }] // B: stale copy
    const tombstones = new Map([['a', '2026-06-05T00:00:00.000Z']])
    expect(mergeState(local, remote, tombstones)).toEqual([])
  })

  it('an exact-tie timestamp (row updatedAt === deletedAt) is still suppressed (tombstone beats ties)', () => {
    const local: Row[] = []
    const remote: Row[] = [{ id: 'a', updatedAt: '2026-06-05T00:00:00.000Z', v: 1 }]
    const tombstones = new Map([['a', '2026-06-05T00:00:00.000Z']])
    expect(mergeState(local, remote, tombstones)).toEqual([])
  })

  it('lets a row survive when its timestamp is strictly after the tombstone (edit-after-delete)', () => {
    const local: Row[] = [] // A: deleted
    const remote: Row[] = [{ id: 'a', updatedAt: '2026-06-06T00:00:00.000Z', v: 2 }] // B: edited AFTER the delete
    const tombstones = new Map([['a', '2026-06-05T00:00:00.000Z']])
    expect(mergeState(local, remote, tombstones)).toEqual([
      { id: 'a', updatedAt: '2026-06-06T00:00:00.000Z', v: 2 },
    ])
  })

  it('is a no-op when no tombstone matches any row id', () => {
    const local: Row[] = [{ id: 'a', updatedAt: '2026-06-01T00:00:00.000Z', v: 1 }]
    const remote: Row[] = []
    const tombstones = new Map([['unrelated-id', '2026-06-05T00:00:00.000Z']])
    expect(mergeState(local, remote, tombstones)).toEqual(local)
  })
})

describe('mergeLedger — tombstone suppression (3rd param, cascade delete)', () => {
  it('suppresses a ledger row (by `at`) at-or-before its tombstone', () => {
    const local = [{ id: 't1', at: '2026-06-01T00:00:00.000Z' }]
    const remote: typeof local = []
    const tombstones = new Map([['t1', '2026-06-05T00:00:00.000Z']])
    expect(mergeLedger(local, remote, tombstones)).toEqual([])
  })

  it('keeps a ledger row created strictly after its tombstone', () => {
    const local = [{ id: 't1', at: '2026-06-06T00:00:00.000Z' }]
    const remote: typeof local = []
    const tombstones = new Map([['t1', '2026-06-05T00:00:00.000Z']])
    expect(mergeLedger(local, remote, tombstones)).toEqual(local)
  })
})

describe('mergeTombstones (union by table+id, LWW by deletedAt)', () => {
  it('unions tombstones unique to each side', () => {
    const local = [tombstone({ id: 'a', table: 'recipes' })]
    const remote = [tombstone({ id: 'b', table: 'recipes' })]
    const out = mergeTombstones(local, remote).sort((x, y) => x.id.localeCompare(y.id))
    expect(out.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('keeps the LATER deletedAt on a same table+id collision', () => {
    const local = [tombstone({ id: 'a', table: 'recipes', deletedAt: '2026-06-01T00:00:00.000Z' })]
    const remote = [tombstone({ id: 'a', table: 'recipes', deletedAt: '2026-06-05T00:00:00.000Z' })]
    expect(mergeTombstones(local, remote)).toEqual([
      tombstone({ id: 'a', table: 'recipes', deletedAt: '2026-06-05T00:00:00.000Z' }),
    ])
  })

  it('prefers local on an exact deletedAt tie (deterministic)', () => {
    const t = '2026-06-01T00:00:00.000Z'
    const localT = tombstone({ id: 'a', table: 'recipes', deletedAt: t })
    const remoteT = tombstone({ id: 'a', table: 'recipes', deletedAt: t })
    expect(mergeTombstones([localT], [remoteT])).toEqual([localT])
  })

  it('the SAME id in DIFFERENT tables never collides (table scopes id)', () => {
    const local = [tombstone({ id: 'shared-id', table: 'recipes' })]
    const remote = [tombstone({ id: 'shared-id', table: 'batches' })]
    const out = mergeTombstones(local, remote)
    expect(out).toHaveLength(2)
    expect(out.map((t) => t.table).sort()).toEqual(['batches', 'recipes'])
  })
})
