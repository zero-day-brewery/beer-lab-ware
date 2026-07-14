/**
 * Brew-session lifecycle control orchestration (Complete / Abort).
 *
 * Extracted from the guided runner so the multi-store choreography is pure and
 * unit-testable with mocked repos/store-actions/confirm — no React, no DOM.
 * The component wires the real deps (batchRepo, session-store actions, router,
 * window.confirm, toast) and handles navigation + toasts from the result.
 */
import { sessionToBatch } from '@/lib/brewing/batch/from-session'
import { BREW_MANUAL } from '@/lib/brewing/process'
import type { BrewSession } from '@/lib/brewing/process/session'
import type { Batch } from '@/lib/brewing/types/batch'
import type { EquipmentProfile } from '@/lib/brewing/types/equipment'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { CalculationResult } from '@/lib/brewing/types/results'

export const COMPLETE_CONFIRM = 'Mark this brew complete? Any remaining steps are skipped.'
export const ABORT_CONFIRM = 'Abort this brew? The batch will be archived.'

/** The one batchRepo method these helpers need — kept minimal for easy mocking. */
export interface BatchSaver {
  save: (b: Batch) => Promise<Batch>
}

export interface CompleteBrewDeps {
  session: BrewSession
  activeBatch: Batch | null
  recipe?: Recipe
  equipment?: EquipmentProfile
  calc?: CalculationResult
  fermenterId: string
  now: string
  batchRepo: BatchSaver
  /** session-store.complete() — flips lifecycle → done. */
  complete: () => void
  /** session-store.flush() — persists the session body. */
  flushSession: () => Promise<void>
  /** session-store.clear() — drops the in-memory session + pointer. */
  clearSession: () => void
  /** active-batch-store.clear() — drops the in-memory batch. */
  clearBatch: () => void
  /** Confirmation gate (window.confirm in the app). */
  confirm: (msg: string) => boolean
}

/**
 * Finalize the active brew: mark the session done, persist the batch as
 * `complete`, and clear both stores so a fresh brew can start.
 *
 * The batch is saved EXPLICITLY here (rather than via the debounced re-map
 * effect) because we tear the active-batch store down immediately afterward —
 * relying on the effect would race the clear() and drop the completion.
 *
 * @returns `{ completed, batchId }` — `completed:false` when the confirm was
 *          declined (no side effects); `batchId` for logbook navigation.
 */
export async function completeBrew(
  deps: CompleteBrewDeps,
): Promise<{ completed: boolean; batchId: string | null }> {
  if (!deps.confirm(COMPLETE_CONFIRM)) return { completed: false, batchId: null }

  const batchId = deps.activeBatch?.id ?? null
  deps.complete()
  await deps.flushSession()

  if (deps.activeBatch) {
    const completed = sessionToBatch({
      session: { ...deps.session, lifecycle: 'done' },
      recipe: deps.recipe,
      equipment: deps.equipment,
      calc: deps.calc,
      manual: BREW_MANUAL,
      id: deps.activeBatch.id,
      batchNo: deps.activeBatch.batchNo,
      now: deps.now,
      existing: deps.activeBatch,
      fermenterId: deps.fermenterId,
    })
    await deps.batchRepo.save(completed)
  }

  deps.clearSession()
  deps.clearBatch()
  return { completed: true, batchId }
}

export interface AbortBrewDeps {
  activeBatch: Batch | null
  now: string
  batchRepo: BatchSaver
  /** Dispatch the reducer `abort` action (lifecycle → aborted). */
  abort: () => void
  flushSession: () => Promise<void>
  clearSession: () => void
  clearBatch: () => void
  confirm: (msg: string) => boolean
}

/**
 * Abort the active brew: ARCHIVE its batch (status `archived` + `archivedAt`,
 * never deleted, never left `in-progress`), flip the session to aborted, and
 * clear both stores. Archiving the batch directly is what actually fixes the
 * re-attach bug — the in-progress board lookups skip archived rows.
 *
 * @returns `{ aborted }` — `false` when the confirm was declined (no effects).
 */
export async function abortBrew(deps: AbortBrewDeps): Promise<{ aborted: boolean }> {
  if (!deps.confirm(ABORT_CONFIRM)) return { aborted: false }

  if (deps.activeBatch) {
    await deps.batchRepo.save({
      ...deps.activeBatch,
      status: 'archived',
      archivedAt: deps.now,
    })
  }

  deps.abort()
  await deps.flushSession()
  deps.clearSession()
  deps.clearBatch()
  return { aborted: true }
}
