import type { Batch } from '@/lib/brewing/types/batch'

export interface BoardDemotion {
  /** The demoted (losing) batch id. */
  id: string
  /** The fermenter vessel they were contending for. */
  board: string
  /** The surviving (winning) batch id. */
  keptId: string
}

export interface BoardResolution {
  rows: Batch[]
  demoted: BoardDemotion[]
}

/**
 * Enforce the invariant "at most one in-progress batch per fermenter vessel".
 *
 * PURE, clock-free and ORDER-INDEPENDENT so restore(), the sync merge, and the
 * data doctor all compute the SAME winner — two devices resolving the same
 * conflict must never disagree, or they ping-pong forever.
 *
 * Only in-progress batches WITH a fermenterBoardId contend. A batch with no
 * board, or any completed/archived batch, is never touched (a vessel legitimately
 * hosts many past brews). Losers are DEMOTED to 'archived' — never deleted, never
 * tombstoned: a tombstone would let the sync merge suppress them fleet-wide, and
 * an archived batch stays fully visible and editable in the logbook. Their
 * updatedAt is bumped to `at` so the repair wins the next LWW sync merge and heals
 * the canonical copy; archivedAt is set only if absent.
 *
 * Winner ranking uses ONLY IMMUTABLE fields, so every device agrees on the
 * winner no matter where its mutable, LWW-synced fields sit in the sync-
 * convergence cycle. `logs.length` and `updatedAt` legitimately differ across
 * devices mid-sync (a log added on one device, a stale copy on another) — rank
 * on them and two devices pick different winners, archive different losers, and
 * LWW then drives the vessel to ZERO in-progress PERMANENTLY (the resolver only
 * ever looks at in-progress rows, so it can never undo that). Immutable ranking:
 *   1. highest batchNo (later mint wins) — never mutated after mint
 *   2. id, code-point ascending — unique + immutable, the final TOTAL-order
 *      tiebreak (batchNo can collide: the very race this guards, and two devices
 *      minting offline both compute max+1).
 * Deliberately NO `Date.parse`: `BatchSchema.updatedAt` is a bare `z.string()`,
 * so a malformed/empty value yields NaN and an intransitive (order-dependent)
 * comparator — the exact defect that would let two devices disagree.
 *
 * Tradeoff to be honest about: the SURVIVING in-progress batch is the
 * later-minted one, NOT necessarily the one with the most brewing activity —
 * determinism over "keep the busiest". The loser is archived, never lost, so a
 * user who wanted the other one can un-archive it.
 */
export function resolveBoardConflicts(batches: Batch[], at: string): BoardResolution {
  const byBoard = new Map<string, Batch[]>()
  for (const b of batches) {
    if (b.status !== 'in-progress' || !b.fermenterBoardId) continue
    const arr = byBoard.get(b.fermenterBoardId)
    if (arr) arr.push(b)
    else byBoard.set(b.fermenterBoardId, [b])
  }

  const loserToKeeper = new Map<string, string>()
  const demoted: BoardDemotion[] = []
  for (const [board, contenders] of byBoard) {
    if (contenders.length < 2) continue
    const [winner, ...losers] = [...contenders].sort(compareWinner)
    for (const loser of losers) {
      loserToKeeper.set(loser.id, winner.id)
      demoted.push({ id: loser.id, board, keptId: winner.id })
    }
  }

  if (loserToKeeper.size === 0) return { rows: batches, demoted: [] }

  const rows = batches.map((b) =>
    loserToKeeper.has(b.id)
      ? { ...b, status: 'archived' as const, archivedAt: b.archivedAt ?? at, updatedAt: at }
      : b,
  )
  return { rows, demoted }
}

function compareWinner(a: Batch, b: Batch): number {
  if (a.batchNo !== b.batchNo) return b.batchNo - a.batchNo // higher batchNo (later mint) wins
  // Code-point compare (NOT localeCompare, which is ICU/locale-dependent) so two
  // devices in different locales still agree. UUIDs make this a strict total order.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
