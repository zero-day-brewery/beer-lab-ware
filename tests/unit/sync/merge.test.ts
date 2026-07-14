import { describe, expect, it } from 'vitest'

import { mergeLedger, mergeState } from '@/lib/sync/merge'

type Row = { id: string; updatedAt?: string; at?: string; v: number }

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
