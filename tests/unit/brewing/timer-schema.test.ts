import { describe, expect, it } from 'vitest'
import { type BrewTimer, BrewTimerSchema } from '@/lib/brewing/types/timer'

const valid: BrewTimer = {
  id: '550e8400-e29b-41d4-a716-446655440300',
  sessionId: '550e8400-e29b-41d4-a716-446655440301',
  stepId: 'ramp-to-boil',
  label: 'Boil',
  durationMin: 60,
  fireAt: '2026-06-25T13:00:00.000Z',
  status: 'armed',
  isBoilMaster: true,
}

describe('BrewTimerSchema', () => {
  it('parses a valid armed timer', () => {
    expect(BrewTimerSchema.parse(valid)).toEqual(valid)
  })

  it('parses a fired timer with firedAt + parentId', () => {
    const fired: BrewTimer = {
      ...valid,
      id: '550e8400-e29b-41d4-a716-446655440302',
      status: 'fired',
      firedAt: '2026-06-25T13:00:01.000Z',
      isBoilMaster: false,
      parentId: '550e8400-e29b-41d4-a716-446655440300',
    }
    expect(BrewTimerSchema.parse(fired)).toEqual(fired)
  })

  it('rejects an unknown status', () => {
    expect(() => BrewTimerSchema.parse({ ...valid, status: 'paused' })).toThrow()
  })

  it('rejects a missing sessionId', () => {
    const { sessionId: _drop, ...rest } = valid
    expect(() => BrewTimerSchema.parse(rest)).toThrow()
  })
})
