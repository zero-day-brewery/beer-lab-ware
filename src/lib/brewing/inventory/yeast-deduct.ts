/**
 * Guarded brew-time yeast deduction — decides + describes the "pitched 1 unit
 * out of a countable lot" decrement that fires (at most once) when a brew is
 * minted into a batch.
 *
 * Countable-only: `packet`/`vial` lots auto-deduct 1 unit. Slurry (`mL`/`g`)
 * is NOT auto-deducted — a partial pitch out of a bulk slurry lot is
 * ambiguous (how much was actually poured?), so slurry stays a manual
 * Yeast Bank adjustment.
 *
 * Idempotency: gated on the PERSISTENT `Batch.yeastDeducted` marker, never a
 * per-instance ref/flag. `shouldDeductYeast` is pure (safe to call as often
 * as the caller likes — it just answers "should I, right now, given what's
 * on the batch"); `applyYeastDeduct` performs the single side effect (via an
 * injected `consume` callback — the caller wires in `yeastLotsRepo.consume`)
 * and reports back the `Batch` patch to persist. Neither imports Dexie/DOM —
 * the wiring lives in the guided-runner mint effect
 * (`src/components/system/run/guided-runner.tsx`), NOT in the pure
 * `sessionToBatch` mapper, which runs on every mint *and* re-map and would
 * double-fire if it triggered the consume itself.
 */
import type { Batch } from '@/lib/brewing/types/batch'
import type { YeastLot } from '@/lib/brewing/types/yeast-lot'

/** Countable forms auto-deduct 1 unit; slurry (mL/g) does not. */
const COUNTABLE_YEAST_UNITS: ReadonlySet<YeastLot['unit']> = new Set(['packet', 'vial'])

export type DeductableBatch = Pick<Batch, 'yeastLotId' | 'yeastDeducted'>
export type DeductableLot = Pick<YeastLot, 'unit'>

/**
 * Pure decision: should the pitched lot be auto-deducted for this batch right
 * now? True only when the batch has a recorded lot, that lot hasn't already
 * been deducted, the lot actually resolved, and its unit is countable
 * (packet/vial) — false for slurry (mL/g), a missing lot, a batch with no
 * recorded lot, or a batch already marked `yeastDeducted`.
 */
export function shouldDeductYeast(
  batch: DeductableBatch,
  lot: DeductableLot | null | undefined,
): boolean {
  if (!batch.yeastLotId) return false
  if (batch.yeastDeducted) return false
  if (!lot) return false
  return COUNTABLE_YEAST_UNITS.has(lot.unit)
}

/**
 * Apply the deduction: when `shouldDeductYeast` says yes, consume 1 unit from
 * the pitched lot via the injected `consume` callback (normally
 * `yeastLotsRepo.consume`) and return the `Batch` patch the caller must
 * persist (`{ yeastDeducted: true }`). Returns `null` — no I/O — when the
 * guard says no (already deducted, slurry, no lot, etc.), so a caller can
 * safely invoke this on every mint-effect run without double-decrementing.
 */
export async function applyYeastDeduct(
  batch: DeductableBatch,
  lot: DeductableLot | null | undefined,
  consume: (lotId: string, amount: number) => Promise<unknown>,
): Promise<{ yeastDeducted: true } | null> {
  const { yeastLotId } = batch
  if (!yeastLotId || !shouldDeductYeast(batch, lot)) return null
  await consume(yeastLotId, 1)
  return { yeastDeducted: true }
}
