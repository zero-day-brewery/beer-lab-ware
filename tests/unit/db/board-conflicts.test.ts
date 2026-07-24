import { describe, expect, it } from 'vitest'
import type { Batch } from '@/lib/brewing/types/batch'
import { resolveBoardConflicts } from '@/lib/db/board-conflicts'

/** Minimal Batch — the resolver only reads id/status/fermenterBoardId/batchNo (+ archivedAt). */
function b(over: Partial<Batch> & { id: string }): Batch {
  return {
    id: over.id,
    batchNo: over.batchNo ?? 1,
    name: 'B',
    status: over.status ?? 'in-progress',
    fermenterBoardId: 'fermenterBoardId' in over ? over.fermenterBoardId : 'f1',
    logs: over.logs ?? [],
    updatedAt: over.updatedAt ?? '2026-07-01T00:00:00.000Z',
    archivedAt: over.archivedAt,
    startedAt: '2026-07-01T00:00:00.000Z',
  } as unknown as Batch
}

const AT = '2026-07-23T20:00:00.000Z'
// biome-ignore lint/suspicious/noExplicitAny: fixtures only need a length
const log = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}` }) as any)

describe('resolveBoardConflicts', () => {
  it('picks the SAME winner regardless of input order — ranked on IMMUTABLE fields only', () => {
    // Higher batchNo (later mint) wins. logs.length / updatedAt are deliberately
    // NOT used: they are mutable + LWW-synced, so two devices mid-sync could hold
    // different values and archive different losers → the vessel could converge to
    // ZERO in-progress. Immutable ranking makes every device agree.
    const rows = [
      b({ id: 'aaa', batchNo: 5, logs: log(9), updatedAt: '2026-07-20T00:00:00.000Z' }),
      b({ id: 'bbb', batchNo: 2, logs: log(3) }),
      b({ id: 'ccc', batchNo: 9, logs: log(0) }), // highest batchNo → winner despite the FEWEST logs
    ]
    const winners = [rows, [...rows].reverse(), [rows[2], rows[0], rows[1]]].map(
      (order) => resolveBoardConflicts(order, AT).rows.find((x) => x.status === 'in-progress')?.id,
    )
    expect(winners).toEqual(['ccc', 'ccc', 'ccc'])
  })

  it('stays order-independent when batchNos COLLIDE and an updatedAt is unparseable (total order via id)', () => {
    // The offline-race case: two devices both mint batchNo=max+1 on one vessel, and
    // BatchSchema permits ANY string for updatedAt (Date.parse → NaN). The winner
    // must be identical across every input order — no intransitive NaN tiebreak.
    const rows = [
      b({ id: 'aaa', batchNo: 8, updatedAt: '2026-01-01T00:00:00.000Z' }),
      b({ id: 'zzz', batchNo: 8, updatedAt: '2026-06-01T00:00:00.000Z' }),
      b({ id: 'mmm', batchNo: 8, updatedAt: '' }), // unparseable — the NaN trap
    ]
    const winners = [
      [rows[0], rows[1], rows[2]],
      [rows[2], rows[1], rows[0]],
      [rows[1], rows[2], rows[0]],
    ].map(
      (order) => resolveBoardConflicts(order, AT).rows.find((x) => x.status === 'in-progress')?.id,
    )
    // id code-point ascending → 'aaa' wins, in every order.
    expect(winners).toEqual(['aaa', 'aaa', 'aaa'])
  })

  it('demotes every loser to archived (never deletes) and bumps updatedAt; winner untouched', () => {
    const winner = b({ id: 'win', batchNo: 2, updatedAt: '2026-07-10T00:00:00.000Z' })
    const loser = b({ id: 'lose', batchNo: 1, updatedAt: '2026-07-05T00:00:00.000Z' })
    const { rows, demoted } = resolveBoardConflicts([winner, loser], AT)

    expect(rows).toHaveLength(2) // nothing deleted
    const w = rows.find((r) => r.id === 'win')
    const l = rows.find((r) => r.id === 'lose')
    expect(w).toEqual(winner) // winner byte-identical
    expect(l?.status).toBe('archived')
    expect(l?.updatedAt).toBe(AT) // bumped so the repair wins the next LWW merge
    expect(demoted).toEqual([{ id: 'lose', board: 'f1', keptId: 'win' }])
  })

  it('never touches batches with no fermenter board', () => {
    const rows = [
      b({ id: 'x', fermenterBoardId: undefined }),
      b({ id: 'y', fermenterBoardId: undefined }),
    ]
    const { rows: out, demoted } = resolveBoardConflicts(rows, AT)
    expect(demoted).toEqual([])
    expect(out.every((r) => r.status === 'in-progress')).toBe(true)
  })

  it('never demotes a completed batch that shares a vessel with the sole in-progress one', () => {
    const rows = [b({ id: 'done', status: 'complete' }), b({ id: 'live', status: 'in-progress' })]
    const { rows: out, demoted } = resolveBoardConflicts(rows, AT)
    expect(demoted).toEqual([])
    expect(out.find((r) => r.id === 'live')?.status).toBe('in-progress')
    expect(out.find((r) => r.id === 'done')?.status).toBe('complete')
  })

  it('resolves each vessel independently', () => {
    const rows = [
      b({ id: 'f1-win', fermenterBoardId: 'f1', batchNo: 2 }),
      b({ id: 'f1-lose', fermenterBoardId: 'f1', batchNo: 1 }),
      b({ id: 'f2-solo', fermenterBoardId: 'f2', batchNo: 1 }),
    ]
    const { demoted } = resolveBoardConflicts(rows, AT)
    expect(demoted).toEqual([{ id: 'f1-lose', board: 'f1', keptId: 'f1-win' }])
  })
})
