import { describe, expect, it } from 'vitest'
import { missedWhileAway, resolveDueTimers } from '@/lib/brewing/process/timer-tick'
import type { BrewTimer } from '@/lib/brewing/types/timer'

const base: BrewTimer = {
  id: '550e8400-e29b-41d4-a716-446655440300',
  sessionId: '550e8400-e29b-41d4-a716-446655440301',
  stepId: 'ramp-to-boil',
  label: 'Boil',
  durationMin: 60,
  fireAt: '2026-06-25T13:00:00.000Z',
  status: 'armed',
  isBoilMaster: false,
}

describe('resolveDueTimers', () => {
  it('fires timers whose fireAt <= now, stamps firedAt', () => {
    const now = '2026-06-25T13:00:00.000Z'
    const { fired, stillArmed } = resolveDueTimers([base], now)
    expect(fired).toHaveLength(1)
    expect(fired[0].status).toBe('fired')
    expect(fired[0].firedAt).toBe(now)
    expect(stillArmed).toHaveLength(0)
  })

  it('keeps future timers armed', () => {
    const now = '2026-06-25T12:59:59.000Z'
    const { fired, stillArmed } = resolveDueTimers([base], now)
    expect(fired).toHaveLength(0)
    expect(stillArmed).toHaveLength(1)
    expect(stillArmed[0].status).toBe('armed')
  })

  it('ignores already-fired / cancelled timers', () => {
    const now = '2026-06-25T14:00:00.000Z'
    const fired: BrewTimer = { ...base, id: 'a', status: 'fired', firedAt: now }
    const cancelled: BrewTimer = { ...base, id: 'b', status: 'cancelled' }
    const res = resolveDueTimers([fired, cancelled], now)
    expect(res.fired).toHaveLength(0)
    expect(res.stillArmed).toHaveLength(0)
  })
})

describe('missedWhileAway — catch-up on hydrate', () => {
  it('returns armed timers that fired strictly before now', () => {
    const now = '2026-06-25T14:30:00.000Z' // 90 min after the 13:00 fireAt
    const missed = missedWhileAway([base], now)
    expect(missed).toHaveLength(1)
    expect(missed[0].id).toBe(base.id)
  })

  it('does not flag a timer due exactly now or in the future', () => {
    expect(missedWhileAway([base], '2026-06-25T13:00:00.000Z')).toHaveLength(0)
    expect(missedWhileAway([base], '2026-06-25T12:30:00.000Z')).toHaveLength(0)
  })
})
