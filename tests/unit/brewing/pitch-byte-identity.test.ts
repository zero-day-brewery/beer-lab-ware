/**
 * Byte-identity tests for the pitched-yeast-lot record: brew-start gate →
 * BrewSession root → Batch root. `yeastLotId` must live at the SESSION and
 * BATCH root — never inside `SessionChoices` (which drives branch resolution)
 * — and must be emitted via conditional spread so a brew with no lot picked
 * persists an identical key-set to before this feature existed.
 */
import { describe, expect, it } from 'vitest'
import { sessionToBatch } from '@/lib/brewing/batch/from-session'
import { BREW_MANUAL } from '@/lib/brewing/process' // verify import path
import { makeSessionFromGate } from '@/lib/brewing/process/session'

const base = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  now: 1_800_000_000_000,
  manualVersion: 1,
}

describe('pitch record byte-identity', () => {
  it('no lot picked → session has NO yeastLotId key (identical key-set to before)', () => {
    const s = makeSessionFromGate({ ...base })
    expect('yeastLotId' in s).toBe(false)
  })

  it('lot picked → session.yeastLotId set at the ROOT (not in choices)', () => {
    const s = makeSessionFromGate({ ...base, yeastLotId: '550e8400-e29b-41d4-a716-446655440099' })
    expect(s.yeastLotId).toBe('550e8400-e29b-41d4-a716-446655440099')
    expect('yeastLotId' in (s.choices as object)).toBe(false)
  })

  it('sessionToBatch carries yeastLotId, and omits it when the session has none', () => {
    const withPick = sessionToBatch({
      session: {
        ...makeSessionFromGate({ ...base, yeastLotId: '550e8400-e29b-41d4-a716-446655440099' }),
      },
      manual: BREW_MANUAL,
      id: base.id,
      batchNo: 1,
      now: '2026-07-13T00:00:00.000Z',
    })
    expect(withPick.yeastLotId).toBe('550e8400-e29b-41d4-a716-446655440099')

    const without = sessionToBatch({
      session: makeSessionFromGate({ ...base }),
      manual: BREW_MANUAL,
      id: base.id,
      batchNo: 1,
      now: '2026-07-13T00:00:00.000Z',
    })
    expect('yeastLotId' in without).toBe(false)
  })

  it('re-map with existing.yeastDeducted === true carries the marker forward (completeBrew must not erase it)', () => {
    const session = makeSessionFromGate({
      ...base,
      yeastLotId: '550e8400-e29b-41d4-a716-446655440099',
    })
    const first = sessionToBatch({
      session,
      manual: BREW_MANUAL,
      id: base.id,
      batchNo: 1,
      now: '2026-07-13T00:00:00.000Z',
    })
    const existing = { ...first, yeastDeducted: true }
    const remapped = sessionToBatch({
      session: { ...session, lifecycle: 'done' },
      manual: BREW_MANUAL,
      id: base.id,
      batchNo: 1,
      now: '2026-07-13T00:01:00.000Z',
      existing,
    })
    expect(remapped.yeastDeducted).toBe(true)
  })

  it('re-map with no existing marker omits yeastDeducted (byte-identity — never fabricated)', () => {
    const batch = sessionToBatch({
      session: makeSessionFromGate({ ...base }),
      manual: BREW_MANUAL,
      id: base.id,
      batchNo: 1,
      now: '2026-07-13T00:00:00.000Z',
    })
    expect('yeastDeducted' in batch).toBe(false)
  })
})
