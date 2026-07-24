/**
 * Which fermenter vessels can accept a NEW brew — the source of truth for the
 * brew-start gate.
 *
 * A vessel is available only when it is BOTH locally marked empty AND has no
 * in-progress batch on it. The local `status` alone is not enough: the fermenter
 * board lives in a device-local (zustand-persist / localStorage) store that is
 * NOT part of the synced data, so on a second device every vessel reads 'empty'
 * even while a synced in-progress batch occupies it. Batches DO sync, so
 * cross-referencing the in-progress batch set is what makes occupancy correct
 * across devices (and prevents starting a second brew on an already-fermenting
 * vessel — see the duplicate-batch/board-conflict invariant).
 *
 * Pure + generic over the row shapes so it stays free of store/UI imports.
 */
export function availableFermenters<F extends { id: string; status: string }>(
  fermenters: readonly F[],
  batches: readonly { status: string; fermenterBoardId?: string }[],
): F[] {
  const occupied = new Set(
    batches
      .filter((b) => b.status === 'in-progress' && b.fermenterBoardId)
      .map((b) => b.fermenterBoardId),
  )
  return fermenters.filter((f) => f.status === 'empty' && !occupied.has(f.id))
}
