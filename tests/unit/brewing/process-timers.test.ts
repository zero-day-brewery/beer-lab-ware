import { describe, expect, it } from 'vitest'
import { boilMasterAlarms, buildTimers } from '@/lib/brewing/process/timers'
import type { TimerSpec } from '@/lib/brewing/process/types'
import type { Recipe } from '@/lib/brewing/types/recipe'
import { BrewTimerSchema } from '@/lib/brewing/types/timer'

const NOW = '2026-06-25T12:00:00.000Z'

const recipe: Recipe = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  name: 'Boil Test',
  type: 'all-grain',
  batchSize_L: 19,
  boilTime_min: 60,
  equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
  fermentables: [],
  hops: [
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440201',
      snapshot: { name: 'Magnum', alphaAcid_pct: 12, form: 'pellet' },
      amount_g: 20,
      time_min: 60,
      use: 'boil',
    },
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440202',
      snapshot: { name: 'Cascade', alphaAcid_pct: 6, form: 'pellet' },
      amount_g: 30,
      time_min: 15,
      use: 'boil',
    },
    {
      ingredientId: '550e8400-e29b-41d4-a716-446655440203',
      snapshot: { name: 'Citra DH', alphaAcid_pct: 12, form: 'pellet' },
      amount_g: 50,
      time_min: 0,
      use: 'dry-hop',
    },
  ],
  yeasts: [],
  miscs: [],
  mashSteps: [
    { name: 'Sacc', type: 'infusion', temperature_C: 66, time_min: 60 },
    { name: 'Mash-out', type: 'temperature', temperature_C: 76, time_min: 10 },
  ],
  notes_md: '',
  createdAt: NOW,
  updatedAt: NOW,
  schemaVersion: 1,
}

describe('buildTimers — fixed/recipe/mashStep durations', () => {
  it('fixed minutes → absolute fireAt = now + minutes', () => {
    const specs: TimerSpec[] = [
      { id: 'strike-heat', label: 'Strike heat-up', durationFrom: { kind: 'fixed', minutes: 30 } },
    ]
    const [t] = buildTimers('heat-strike-water', specs, { recipe, now: NOW })
    expect(t.durationMin).toBe(30)
    expect(t.fireAt).toBe('2026-06-25T12:30:00.000Z')
    expect(t.isBoilMaster).toBe(false)
    expect(t.stepId).toBe('heat-strike-water')
  })

  it('recipe boilTime_min → uses recipe.boilTime_min', () => {
    const specs: TimerSpec[] = [
      { id: 'boil', label: 'Boil', durationFrom: { kind: 'recipe', path: 'boilTime_min' } },
    ]
    const [t] = buildTimers('ramp-to-boil', specs, { recipe, now: NOW })
    expect(t.durationMin).toBe(60)
    expect(t.fireAt).toBe('2026-06-25T13:00:00.000Z')
  })

  it('mashStep index → uses that mash step time_min', () => {
    const specs: TimerSpec[] = [
      { id: 'mash-out', label: 'Mash-out', durationFrom: { kind: 'mashStep', index: 1 } },
    ]
    const [t] = buildTimers('mash-rest', specs, { recipe, now: NOW })
    expect(t.durationMin).toBe(10)
    expect(t.fireAt).toBe('2026-06-25T12:10:00.000Z')
  })
})

describe('boilMasterAlarms — hop child timers', () => {
  it('schedules boil-use hops at (boilTime − time_min), excludes dry-hop', () => {
    const alarms = boilMasterAlarms('boil-master-id', 'fire-hop-additions', recipe, NOW)
    // 60-min boil: Magnum (60) at offset 0; Cascade (15) at offset 45. Dry-hop excluded.
    expect(alarms).toHaveLength(2)
    const magnum = alarms.find((a) => a.label.includes('Magnum'))
    const cascade = alarms.find((a) => a.label.includes('Cascade'))
    expect(magnum?.fireAt).toBe('2026-06-25T12:00:00.000Z') // offset 0
    expect(cascade?.fireAt).toBe('2026-06-25T12:45:00.000Z') // offset 45
    expect(magnum?.parentId).toBe('boil-master-id')
    expect(magnum?.isBoilMaster).toBe(false)
  })

  it('buildTimers expands an isBoilMaster spec into master + children', () => {
    const specs: TimerSpec[] = [
      {
        id: 'boil-master',
        label: 'Boil master',
        durationFrom: { kind: 'recipe', path: 'boilTime_min' },
        isBoilMaster: true,
      },
    ]
    const timers = buildTimers('fire-hop-additions', specs, { recipe, now: NOW })
    // 1 master + 2 hop children
    expect(timers.filter((t) => t.isBoilMaster)).toHaveLength(1)
    expect(timers.filter((t) => t.parentId === 'boil-master')).toHaveLength(2)
    expect(timers).toHaveLength(3)
  })
})

// C1 regression: buildTimers() output (deterministic ids like 'strike-heat',
// 'boil-master--hop-0') must round-trip through BrewTimerSchema.parse() without
// throwing — they are NOT UUIDs and must not be validated as such.
describe('C1 regression — buildTimers output round-trips through BrewTimerSchema', () => {
  const SESSION_ID = '550e8400-e29b-41d4-a716-446655440301'

  it('deterministic timer ids (strike-heat, boil-master, boil-master--hop-N) parse without throwing', () => {
    const specs: TimerSpec[] = [
      { id: 'strike-heat', label: 'Strike heat-up', durationFrom: { kind: 'fixed', minutes: 30 } },
      {
        id: 'boil-master',
        label: 'Boil master',
        durationFrom: { kind: 'recipe', path: 'boilTime_min' },
        isBoilMaster: true,
      },
    ]
    const instances = buildTimers('fire-hop-additions', specs, { recipe, now: NOW })
    // 1 strike + 1 boil master + 2 hop children = 4 timers
    expect(instances).toHaveLength(4)

    // Round-trip each through BrewTimerSchema by adding the required persistence fields
    for (const inst of instances) {
      const row = {
        ...inst,
        sessionId: SESSION_ID,
        status: 'armed' as const,
      }
      // Must NOT throw — this is the exact path timerRepo.saveMany() takes
      expect(() => BrewTimerSchema.parse(row)).not.toThrow()
    }
  })
})
