import { describe, expect, it, vi } from 'vitest'

import { applyYeastDeduct, shouldDeductYeast } from '@/lib/brewing/inventory/yeast-deduct'

describe('shouldDeductYeast', () => {
  it('true when a countable (packet) lot is pitched and not yet deducted', () => {
    expect(
      shouldDeductYeast({ yeastLotId: 'lot-1', yeastDeducted: undefined }, { unit: 'packet' }),
    ).toBe(true)
  })

  it('true for vial too', () => {
    expect(shouldDeductYeast({ yeastLotId: 'lot-1' }, { unit: 'vial' })).toBe(true)
  })

  it('false for slurry mL — partial-pitch ambiguity, stays manual', () => {
    expect(shouldDeductYeast({ yeastLotId: 'lot-1' }, { unit: 'mL' })).toBe(false)
  })

  it('false for slurry g', () => {
    expect(shouldDeductYeast({ yeastLotId: 'lot-1' }, { unit: 'g' })).toBe(false)
  })

  it('false when the batch has no recorded yeastLotId', () => {
    expect(shouldDeductYeast({ yeastLotId: undefined }, { unit: 'packet' })).toBe(false)
  })

  it('false when the batch is already marked yeastDeducted (idempotency guard)', () => {
    expect(
      shouldDeductYeast({ yeastLotId: 'lot-1', yeastDeducted: true }, { unit: 'packet' }),
    ).toBe(false)
  })

  it('false when the lot did not resolve (deleted/missing)', () => {
    expect(shouldDeductYeast({ yeastLotId: 'lot-1' }, undefined)).toBe(false)
    expect(shouldDeductYeast({ yeastLotId: 'lot-1' }, null)).toBe(false)
  })
})

describe('applyYeastDeduct', () => {
  it('consumes exactly 1 unit and returns the yeastDeducted marker patch', async () => {
    const consume = vi.fn().mockResolvedValue(undefined)
    const patch = await applyYeastDeduct({ yeastLotId: 'lot-1' }, { unit: 'packet' }, consume)
    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith('lot-1', 1)
    expect(patch).toEqual({ yeastDeducted: true })
  })

  it('does NOT decrement again on a second run once already marked — the whole idempotency point', async () => {
    const consume = vi.fn().mockResolvedValue(undefined)
    const first = await applyYeastDeduct({ yeastLotId: 'lot-1' }, { unit: 'packet' }, consume)
    expect(first).toEqual({ yeastDeducted: true })
    expect(consume).toHaveBeenCalledTimes(1)

    // Simulate the caller persisting the marker, then calling again (e.g. a remount).
    const second = await applyYeastDeduct(
      { yeastLotId: 'lot-1', yeastDeducted: true },
      { unit: 'packet' },
      consume,
    )
    expect(second).toBeNull()
    expect(consume).toHaveBeenCalledTimes(1) // still 1 — no re-decrement
  })

  it('is a no-op for slurry (mL/g) — leaves it for manual deduction', async () => {
    const consume = vi.fn()
    const patch = await applyYeastDeduct({ yeastLotId: 'lot-1' }, { unit: 'mL' }, consume)
    expect(consume).not.toHaveBeenCalled()
    expect(patch).toBeNull()
  })

  it('is a no-op when no lot is recorded on the batch', async () => {
    const consume = vi.fn()
    const patch = await applyYeastDeduct({ yeastLotId: undefined }, { unit: 'packet' }, consume)
    expect(consume).not.toHaveBeenCalled()
    expect(patch).toBeNull()
  })
})
