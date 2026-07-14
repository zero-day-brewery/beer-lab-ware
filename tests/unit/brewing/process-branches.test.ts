import { describe, expect, it } from 'vitest'
import { evalPredicate, resolveBranches } from '@/lib/brewing/process/branches'
import type { BranchPredicate, ProcessChoices, ProcessManual } from '@/lib/brewing/process/types'
import type { Recipe } from '@/lib/brewing/types/recipe'
import type { Volumes } from '@/lib/brewing/types/results'

const baseRecipe = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test',
    type: 'all-grain',
    batchSize_L: 23,
    boilTime_min: 60,
    equipmentProfileId: '550e8400-e29b-41d4-a716-446655440010',
    fermentables: [],
    hops: [],
    yeasts: [],
    miscs: [],
    mashSteps: [{ name: 'Saccharification', type: 'temperature', temperature_C: 66, time_min: 60 }],
    notes_md: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
    ...over,
  }) as Recipe

const vols = (sparge: number): Volumes => ({
  mashWater_L: 13,
  spargeWater_L: sparge,
  preBoilVolume_L: 27.6,
  postBoilVolume_L: 26,
  intoFermenter_L: 23,
})

const noChoices: ProcessChoices = {}

describe('evalPredicate', () => {
  it('stepMash: true when mashSteps.length > 1', () => {
    const r = baseRecipe({
      mashSteps: [
        { name: 'A', type: 'temperature', temperature_C: 63, time_min: 30 },
        { name: 'B', type: 'temperature', temperature_C: 72, time_min: 20 },
      ],
    })
    expect(evalPredicate({ t: 'stepMash' }, r, noChoices, vols(20))).toBe(true)
    expect(evalPredicate({ t: 'stepMash' }, baseRecipe(), noChoices, vols(20))).toBe(false)
  })

  it('hasMashOut: matches a mash-out step by name', () => {
    const r = baseRecipe({
      mashSteps: [
        { name: 'Sacch', type: 'temperature', temperature_C: 66, time_min: 60 },
        { name: 'Mash Out', type: 'temperature', temperature_C: 76, time_min: 10 },
      ],
    })
    expect(evalPredicate({ t: 'hasMashOut' }, r, noChoices, vols(20))).toBe(true)
    expect(evalPredicate({ t: 'hasMashOut' }, baseRecipe(), noChoices, vols(20))).toBe(false)
  })

  it('hasWhirlpool: true when any hop use is whirlpool', () => {
    const hop = {
      ingredientId: '00000000-0000-0000-0000-0000000000aa',
      snapshot: { name: 'Citra', alphaAcid_pct: 12, form: 'pellet' as const },
      amount_g: 28,
      time_min: 0,
      use: 'whirlpool' as const,
    }
    expect(
      evalPredicate({ t: 'hasWhirlpool' }, baseRecipe({ hops: [hop] }), noChoices, vols(20)),
    ).toBe(true)
    expect(evalPredicate({ t: 'hasWhirlpool' }, baseRecipe(), noChoices, vols(20))).toBe(false)
  })

  it('hasDryHop: true when any hop use is dry-hop', () => {
    const hop = {
      ingredientId: '00000000-0000-0000-0000-0000000000bb',
      snapshot: { name: 'Mosaic', alphaAcid_pct: 12, form: 'pellet' as const },
      amount_g: 60,
      time_min: 4320,
      use: 'dry-hop' as const,
    }
    expect(
      evalPredicate({ t: 'hasDryHop' }, baseRecipe({ hops: [hop] }), noChoices, vols(20)),
    ).toBe(true)
    expect(evalPredicate({ t: 'hasDryHop' }, baseRecipe(), noChoices, vols(20))).toBe(false)
  })

  it('hasMiscs: true when miscs non-empty', () => {
    const misc = {
      ingredientId: '00000000-0000-0000-0000-0000000000cc',
      snapshot: { name: 'Whirlfloc', type: 'fining' as const },
      amount: 1,
      amountUnit: 'each' as const,
      use: 'boil' as const,
      time_min: 15,
    }
    expect(
      evalPredicate({ t: 'hasMiscs' }, baseRecipe({ miscs: [misc] }), noChoices, vols(20)),
    ).toBe(true)
    expect(evalPredicate({ t: 'hasMiscs' }, baseRecipe(), noChoices, vols(20))).toBe(false)
  })

  it('noSparge: true when choice set OR computed spargeWater_L <= 0', () => {
    expect(evalPredicate({ t: 'noSparge' }, baseRecipe(), { noSparge: true }, vols(20))).toBe(true)
    expect(evalPredicate({ t: 'noSparge' }, baseRecipe(), noChoices, vols(0))).toBe(true)
    expect(evalPredicate({ t: 'noSparge' }, baseRecipe(), noChoices, vols(20))).toBe(false)
  })

  it('carbPath: matches the chosen path', () => {
    expect(
      evalPredicate({ t: 'carbPath', eq: 'co2' }, baseRecipe(), { carbPath: 'co2' }, vols(20)),
    ).toBe(true)
    expect(
      evalPredicate({ t: 'carbPath', eq: 'nitro' }, baseRecipe(), { carbPath: 'co2' }, vols(20)),
    ).toBe(false)
    expect(evalPredicate({ t: 'carbPath', eq: 'co2' }, baseRecipe(), noChoices, vols(20))).toBe(
      false,
    )
  })

  it('usesStarter / pressureFromPitch: read straight from choices', () => {
    expect(evalPredicate({ t: 'usesStarter' }, baseRecipe(), { usesStarter: true }, vols(20))).toBe(
      true,
    )
    expect(evalPredicate({ t: 'usesStarter' }, baseRecipe(), noChoices, vols(20))).toBe(false)
    expect(
      evalPredicate(
        { t: 'pressureFromPitch' },
        baseRecipe(),
        { pressureFromPitch: true },
        vols(20),
      ),
    ).toBe(true)
    expect(evalPredicate({ t: 'pressureFromPitch' }, baseRecipe(), noChoices, vols(20))).toBe(false)
  })

  it('not: negates the inner predicate', () => {
    const p: BranchPredicate = { t: 'not', of: { t: 'noSparge' } }
    expect(evalPredicate(p, baseRecipe(), noChoices, vols(20))).toBe(true)
    expect(evalPredicate(p, baseRecipe(), { noSparge: true }, vols(20))).toBe(false)
  })

  it('missing recipe/vols: collection predicates resolve false, not throw', () => {
    expect(evalPredicate({ t: 'hasDryHop' }, undefined, noChoices, undefined)).toBe(false)
    expect(evalPredicate({ t: 'noSparge' }, undefined, noChoices, undefined)).toBe(false)
  })
})

describe('resolveBranches', () => {
  const manual: ProcessManual = {
    version: 1,
    stages: [
      {
        id: 'hotside',
        title: 'Hot Side',
        steps: [
          { id: 'always-a', title: 'A', body_md: '', values: [], logs: [], timers: [] },
          {
            id: 'sparge-bed',
            title: 'Sparge',
            body_md: '',
            values: [],
            logs: [],
            timers: [],
            branch: { t: 'not', of: { t: 'noSparge' } },
          },
          {
            id: 'whirlpool',
            title: 'WP',
            body_md: '',
            values: [],
            logs: [],
            timers: [],
            branch: { t: 'hasWhirlpool' },
          },
        ],
      },
    ],
  }

  it('includes unbranched steps + branched steps whose predicate is true', () => {
    const set = resolveBranches(manual, baseRecipe(), noChoices, vols(20))
    expect(set.has('always-a')).toBe(true)
    expect(set.has('sparge-bed')).toBe(true) // not(noSparge) true when sparge > 0
    expect(set.has('whirlpool')).toBe(false)
  })

  it('drops a branched step when its predicate is false', () => {
    const set = resolveBranches(manual, baseRecipe(), { noSparge: true }, vols(0))
    expect(set.has('sparge-bed')).toBe(false)
    expect(set.has('always-a')).toBe(true)
  })
})
